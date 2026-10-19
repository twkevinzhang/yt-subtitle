import { z } from "zod";
import {
  jobKeySchema,
  segmentSchema,
  assertJobKey,
  type AlignmentSnapshot,
  type JobKey,
} from "./contracts";
import { lineSchema } from "../shared/schemas";
import { ModelSession } from "./model-session";
import { WorkerClient } from "./worker-client";
import { PcmAudioSource } from "./audio-source";
import { takeJobAudio, clearJobAudio } from "./audio-store";
import { createScheduler } from "./scheduler";
import { createSnapshot, mergeSegment } from "./snapshot";

const startSchema = z
  .object({
    key: jobKeySchema,
    assetId: z.string().min(1).max(100),
    lines: z.array(lineSchema).max(10000),
    segments: z.array(segmentSchema).max(1000),
    positionMs: z.number().finite().nonnegative(),
  })
  .strict();
let snapshot: AlignmentSnapshot | undefined,
  controller: AbortController | undefined;
let scheduler: ReturnType<typeof createScheduler> | undefined;
let phase:
  "idle" | "preparing" | "running" | "complete" | "cancelled" | "failed" =
  "idle";
let owner: symbol | undefined, preparingKey: JobKey | undefined;
let error: string | undefined;
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
  controller = abort;
  phase = "preparing";
  error = undefined;
  session.retain();
  let audio: PcmAudioSource | undefined;
  try {
    // Host must be prepared before staging PCM. Binary never crosses runtime JSON.
    audio = new PcmAudioSource(
      new Float32Array(await takeJobAudio(input.assetId)),
    );
    if (abort.signal.aborted) throw new Error("校時已取消");
    const prepared = createSnapshot(input.key, input.lines, input.segments);
    const work = createScheduler(
      input.segments,
      input.lines,
      audio,
      session,
      async (segment, lines) => {
        if (abort.signal.aborted || owner !== token) return;
        const next = mergeSegment(
          snapshot!,
          {
            key: input.key,
            segmentId: segment.id,
            sequence: snapshot!.sequence + 1,
            lines,
          },
          input.segments,
        );
        if (next === snapshot) throw new Error("片段未通過邊界校驗");
        snapshot = next;
        snapshot.modelState = session.state;
        await notify();
      },
      (_segment, cause) => {
        if (owner === token)
          error = cause instanceof Error ? cause.message : String(cause);
      },
    );
    snapshot = prepared;
    scheduler = work;
    preparingKey = undefined;
    phase = "running";
    work.updatePosition(input.positionMs);
    const source = audio;
    void work
      .run(abort.signal)
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
            ? "complete"
            : "failed";
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
      return {
        snapshot,
        phase,
        error,
        modelState: session.state,
        initializationCount: session.initializationCount,
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
