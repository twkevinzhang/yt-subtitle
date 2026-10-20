import type { AlignmentMode, SubtitleLine, AlignedLine } from "../shared/types";
import type { AcousticInput, RecognitionInput } from "./model-session";
import type { JobKey, TimeRange } from "./contracts";
import type { RangeAudioSource } from "./progressive-audio-source";
import {
  createAlignmentPolicy,
  type AlignmentProgress,
} from "./alignment-policy";
import { locateLyrics } from "./lyric-locator";
import { lockTiming, mergeTiming } from "../lyrics/timing-locks";
import { validateSegment, AcousticBoundaryError } from "./validate-segment";
export interface WorkModel {
  prepare(): Promise<void>;
  transcribe(input: RecognitionInput): Promise<string>;
  align(input: AcousticInput): Promise<AlignedLine[]>;
  cancel(): Promise<void>;
}
export async function runSubtitleAlignment(
  input: {
    key: JobKey;
    lines: SubtitleLine[];
    durationMs: number;
    mode: AlignmentMode;
    signal: AbortSignal;
  },
  deps: {
    source: () => RangeAudioSource;
    model: WorkModel;
    positionMs: () => number;
    publish: (progress: AlignmentProgress) => void;
  },
): Promise<AlignmentProgress> {
  let lines = input.lines.map((l) => lockTiming(l, input.durationMs)),
    audio: RangeAudioSource | undefined,
    sequence = 0;
  const checked: TimeRange[] = [],
    ready: TimeRange[] = lines
      .filter(
        (l) => !l.excluded && l.startMs !== undefined && l.endMs !== undefined,
      )
      .map((l) => ({ startMs: l.startMs!, endMs: l.endMs! })),
    policy = createAlignmentPolicy(input.mode, input.durationMs);
  const complete = () =>
    lines.every(
      (l) => l.excluded || (l.startMs !== undefined && l.endMs !== undefined),
    );
  const publish = (phase: AlignmentProgress["phase"], error?: string) => {
    const progress: AlignmentProgress = {
      key: input.key,
      mode: input.mode,
      generation: audio?.generation ?? 0,
      sequence: ++sequence,
      lines: structuredClone(lines),
      checked: [...checked],
      ready: [...ready],
      phase,
      error,
    };
    deps.publish(progress);
    return progress;
  };
  const check = () => {
    if (input.signal.aborted) throw new Error("工作已取消");
  };
  if (complete()) return publish("complete");
  const abort = () => {
    void deps.model.cancel().catch(() => {});
    audio?.dispose();
  };
  input.signal.addEventListener("abort", abort, { once: true });
  try {
    check();
    publish("loading");
    await deps.model.prepare();
    check();
    audio = deps.source();
    while (!complete()) {
      check();
      const range = policy.nextRanges(deps.positionMs(), checked)[0];
      if (!range) break;
      publish("buffering");
      await audio.ensure(range, input.signal);
      check();
      const generation = audio.generation;
      publish("running");
      const location = await locateLyrics(
        lines,
        range,
        audio,
        deps.model,
        input.signal,
      );
      if (generation !== audio.generation) continue;
      for (const segment of location.segments) {
        let candidate = segment;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await audio.ensure(candidate, input.signal);
            const { pcm } = await audio.read(
              candidate.startMs,
              candidate.endMs,
            );
            const result = await deps.model.align({
              segment: candidate,
              lines,
              pcm,
            });
            check();
            if (generation !== audio.generation) break;
            const owned = lines.filter((l) => candidate.lineIds.includes(l.id));
            const validation = validateSegment(result, candidate, owned);
            if (!validation.ok)
              throw new AcousticBoundaryError(validation.reason);
            const found = new Map(result.map((l) => [l.id, l]));
            lines = lines.map((l) =>
              found.has(l.id)
                ? mergeTiming(l, found.get(l.id)!, input.durationMs)
                : l,
            );
            for (const l of owned) {
              const updated = lines.find((x) => x.id === l.id)!;
              if (updated.startMs !== undefined && updated.endMs !== undefined)
                ready.push({ startMs: updated.startMs, endMs: updated.endMs });
            }
            break;
          } catch (error) {
            if (input.signal.aborted) throw error;
            if (!(error instanceof AcousticBoundaryError)) throw error;
            if (attempt === 1) break;
            candidate = {
              ...segment,
              startMs: Math.max(0, segment.startMs - 2000),
              endMs: Math.min(input.durationMs, segment.endMs + 2000),
            };
            if (candidate.endMs - candidate.startMs > 30000)
              candidate.endMs = candidate.startMs + 30000;
          }
        }
      }
      if (generation !== audio.generation) continue;
      checked.push(range);
      ready.push(...location.silent);
      // Union verified windows; unknown/ambiguous windows never unlock playback.
      ready.sort((a, b) => a.startMs - b.startMs);
      for (let i = 1; i < ready.length;)
        if (ready[i].startMs <= ready[i - 1].endMs) {
          ready[i - 1].endMs = Math.max(ready[i - 1].endMs, ready[i].endMs);
          ready.splice(i, 1);
        } else i++;
      publish("running");
    }
    return publish(
      complete() ? "complete" : "partial",
      complete() ? undefined : "部分句子沒有可靠定位，文字與已完成時間均已保留",
    );
  } catch (error) {
    publish(
      input.signal.aborted ? "cancelled" : "failed",
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  } finally {
    input.signal.removeEventListener("abort", abort);
    audio?.dispose();
    await deps.model.cancel();
  }
}
