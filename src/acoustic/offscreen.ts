import { z } from "zod";
import {
  jobKeySchema,
  segmentSchema,
  assertJobKey,
  type AlignmentSnapshot,
  type JobKey,
} from "./contracts";
import { lineSchema, cueSchema } from "../shared/schemas";
import { locateMissing } from "./missing-location";
import type { AlignedLine } from "../shared/types";
import type { Segment } from "./contracts";
import { ModelSession } from "./model-session";
import { WorkerClient } from "./worker-client";
import { PcmAudioSource } from "./audio-source";
import { assertAudioSize } from "./audio-source";
import { takeJobAudio, clearJobAudio } from "./audio-store";
import { createScheduler } from "./scheduler";
import { createSnapshot, mergeSegment } from "./snapshot";
import { AcousticBoundaryError, validateSegment } from "./validate-segment";

const startSchema = z
  .object({
    key: jobKeySchema,
    assetId: z.string().min(1).max(100),
    lines: z.array(lineSchema).max(10000),
    segments: z.array(segmentSchema).max(1000),
    positionMs: z.number().finite().nonnegative(),
    encoding: z.enum(["pcm", "compressed"]).default("pcm"),
    durationMs: z.number().finite().positive().optional(),
    cues: z.array(cueSchema).max(20000).default([]),
    bounds: z
      .record(
        z.object({
          startMs: z.number().finite().nonnegative(),
          endMs: z.number().finite().nonnegative(),
        }),
      )
      .optional(),
  })
  .strict();
let snapshot: AlignmentSnapshot | undefined,
  controller: AbortController | undefined;
let scheduler: ReturnType<typeof createScheduler> | undefined;
let phase:
  | "idle"
  | "preparing"
  | "running"
  | "complete"
  | "partial"
  | "cancelled"
  | "failed" = "idle";
let owner: symbol | undefined, preparingKey: JobKey | undefined;
let error: string | undefined;
let locationDiagnostics: string[] = [];
let positionMs = 0;
const session = new ModelSession(
  () => new WorkerClient(),
  () => {
    void chrome.runtime
      .sendMessage({ target: "acoustic-background", type: "idle" })
      .catch(() => {});
  },
);
const cleaned = clearJobAudio();
async function notify() {
  await chrome.runtime
    .sendMessage({
      target: "acoustic-background",
      type: "snapshot",
      snapshot,
      phase,
      error,
    })
    .catch(() => {});
}
async function start(raw: unknown) {
  await cleaned;
  if (owner) throw new Error("已有聲學工作正在處理");
  const input = startSchema.parse(raw);
  if (new TextEncoder().encode(JSON.stringify(input)).length > 200000)
    throw new Error("歌詞工作超過暫存上限");
  const token = Symbol(),
    abort = new AbortController(),
    previousPhase = phase;
  owner = token;
  preparingKey = input.key;
  positionMs = input.positionMs;
  controller = abort;
  phase = "preparing";
  error = undefined;
  locationDiagnostics = [];
  session.retain();
  let audio: PcmAudioSource | undefined;
  try {
    // Host must be prepared before staging PCM. Binary never crosses runtime JSON.
    const data = await takeJobAudio(input.assetId);
    let pcm: Float32Array;
    if (input.encoding === "compressed") {
      if (!input.durationMs || input.durationMs * 64 > 64 * 1024 * 1024)
        throw new Error("音訊解碼長度超過上限");
      const context = new AudioContext({ sampleRate: 16000 });
      try {
        const decoded = await context.decodeAudioData(data);
        if (
          decoded.sampleRate !== 16000 ||
          Math.abs(decoded.duration * 1000 - input.durationMs) > 1000
        )
          throw new Error("解碼音訊與影片長度不符");
        assertAudioSize(decoded.length * 4);
        // Codec padding can end a few milliseconds before the video timeline.
        pcm = new Float32Array(Math.ceil(input.durationMs * 16));
        for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
          const source = decoded.getChannelData(channel);
          for (let i = 0; i < Math.min(source.length, pcm.length); i++)
            pcm[i] += source[i] / decoded.numberOfChannels;
        }
      } finally {
        await context.close();
      }
    } else pcm = new Float32Array(data);
    audio = new PcmAudioSource(pcm);
    if (abort.signal.aborted) throw new Error("校時已取消");
    const prepared = createSnapshot(input.key, input.lines, input.segments);
    const publish = async (
      segment: Segment,
      lines: AlignedLine[],
      repairedContext: AlignedLine[] = [],
    ) => {
      if (abort.signal.aborted || owner !== token) return;
      const first = snapshot!.lines.findIndex(
        (l) => l.id === segment.lineIds[0],
      );
      if (
        repairedContext.length &&
        (repairedContext.length !== 1 ||
          repairedContext[0].id !== snapshot!.lines[first - 1]?.id ||
          !segment.contextLineIds.includes(repairedContext[0].id) ||
          snapshot!.lines[first - 1].startMs === undefined)
      )
        throw new AcousticBoundaryError("不合法的交界重算範圍");
      const combined = {
        ...segment,
        lineIds: [...repairedContext.map((l) => l.id), ...segment.lineIds],
      };
      const validation = validateSegment(
        [...repairedContext, ...lines],
        combined,
        snapshot!.lines,
      );
      if (!validation.ok) throw new AcousticBoundaryError(validation.reason);
      const before = repairedContext.length
        ? {
            ...snapshot!,
            lines: snapshot!.lines.map(
              (l) => repairedContext.find((r) => r.id === l.id) ?? l,
            ),
          }
        : snapshot!;
      const next = mergeSegment(
        before,
        {
          key: input.key,
          segmentId: segment.id,
          sequence: snapshot!.sequence + 1,
          lines,
        },
        input.segments.map((s) => (s.id === segment.id ? segment : s)),
      );
      if (next === before)
        throw new AcousticBoundaryError("片段未通過邊界校驗");
      snapshot = next;
      snapshot.modelState = session.state;
      await notify();
    };
    const failed = (_segment: Segment, cause: unknown) => {
      if (owner === token)
        error = cause instanceof Error ? cause.message : String(cause);
    };
    // Validate ownership synchronously before acknowledging start.
    let work = createScheduler(
      input.segments,
      input.lines,
      audio,
      session,
      publish,
      failed,
      input.cues,
    );
    snapshot = prepared;
    preparingKey = undefined;
    phase = "running";
    const source = audio;
    void (async () => {
      // An omitted short intro is needed as acoustic context for the first
      // known verse. Locate it before publishing that verse with no context.
      const firstOwner = Math.min(
        ...input.segments.map((s) =>
          input.lines.findIndex((l) => l.id === s.lineIds[0]),
        ),
      );
      const introEnd = input.segments.find((s) =>
        s.lineIds.includes(input.lines[firstOwner]?.id),
      )?.startMs;
      if (
        firstOwner > 0 &&
        input.cues.length &&
        introEnd !== undefined &&
        introEnd <= 30000 &&
        positionMs < introEnd
      ) {
        const intro = await locateMissing(
          input.lines.slice(0, firstOwner + 1),
          input.segments,
          input.cues,
          source,
          session,
          abort.signal,
          (message) => {
            if (owner === token && locationDiagnostics.length < 8)
              locationDiagnostics.push(message);
          },
          input.bounds,
        );
        if (abort.signal.aborted || owner !== token) return {};
        input.segments.push(...intro);
        for (const segment of intro) snapshot!.segments[segment.id] = "pending";
      }
      work = createScheduler(
        input.segments,
        input.lines,
        source,
        session,
        publish,
        failed,
        input.cues,
      );
      scheduler = work;
      work.updatePosition(positionMs);
      return work.run(abort.signal);
    })()
      .then(async (states) => {
        if (abort.signal.aborted || owner !== token) return states;
        const located = await locateMissing(
          input.lines,
          input.segments,
          input.cues,
          source,
          session,
          abort.signal,
          (message) => {
            if (owner === token && locationDiagnostics.length < 8)
              locationDiagnostics.push(message);
          },
          input.bounds,
        );
        if (!located.length || abort.signal.aborted || owner !== token)
          return states;
        input.segments.push(...located);
        for (const segment of located)
          snapshot!.segments[segment.id] = "pending";
        const extra = createScheduler(
          located,
          snapshot!.lines,
          source,
          session,
          publish,
          failed,
          input.cues,
        );
        scheduler = extra;
        extra.updatePosition(positionMs);
        await notify();
        return { ...states, ...(await extra.run(abort.signal)) };
      })
      .then((states) => {
        if (owner !== token) return;
        if (snapshot) {
          snapshot.segments = {
            ...states,
            ...Object.fromEntries(
              Object.entries(snapshot.segments).filter(
                ([, s]) => s === "verified",
              ),
            ),
          };
          snapshot.modelState = session.state;
        }
        phase = abort.signal.aborted
          ? "cancelled"
          : Object.values(states).every((s) => s === "verified")
            ? snapshot!.lines.every(
                (l) =>
                  l.excluded ||
                  (l.startMs !== undefined && l.endMs !== undefined),
              )
              ? "complete"
              : "partial"
            : "failed";
        if (phase === "partial")
          error = "部分歌詞未取得可靠定位，已完成片段保留，尚不能完整保存";
        if (phase === "failed") error ??= "部分片段尚未完成校時";
      })
      .catch((e) => {
        if (owner === token) {
          phase = abort.signal.aborted ? "cancelled" : "failed";
          error = String(e.message);
        }
      })
      .finally(async () => {
        source.dispose();
        session.release();
        if (owner === token) {
          controller = undefined;
          scheduler = undefined;
          owner = undefined;
          await notify();
        }
      });
    return { key: input.key };
  } catch (e) {
    audio?.dispose();
    session.release();
    if (owner === token) {
      owner = undefined;
      preparingKey = undefined;
      controller = undefined;
      scheduler = undefined;
      phase = abort.signal.aborted ? "cancelled" : previousPhase;
    }
    throw e;
  }
}
function check(key: JobKey) {
  const expected = preparingKey ?? snapshot?.key;
  if (!expected) throw new Error("沒有聲學工作");
  assertJobKey(expected, key);
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.target !== "acoustic-host") return false;
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL("background.js")
  ) {
    reply({ ok: false, error: "未授權聲學控制來源" });
    return false;
  }
  void (async () => {
    if (message.command === "start") return start(message.input);
    if (message.command === "query") {
      await cleaned;
      if (snapshot) snapshot.modelState = session.state;
      return {
        snapshot,
        key: preparingKey ?? snapshot?.key,
        phase,
        error,
        modelState: session.state,
        initializationCount: session.initializationCount,
        locationDiagnostics,
      };
    }
    if (message.command === "cancel") {
      check(message.key);
      controller?.abort();
      session.cancel();
      return null;
    }
    if (message.command === "position") {
      check(message.key);
      if (!Number.isFinite(message.timeMs) || message.timeMs < 0)
        throw new Error("播放位置不合法");
      positionMs = message.timeMs;
      scheduler?.updatePosition(message.timeMs);
      return null;
    }
    if (message.command === "dispose") {
      if (owner) throw new Error("聲學工作尚未結束");
      await session.dispose();
      await clearJobAudio();
      return null;
    }
    throw new Error("未知聲學控制指令");
  })().then(
    (data) => reply({ ok: true, data }),
    (e) => reply({ ok: false, error: String(e.message) }),
  );
  return true;
});
