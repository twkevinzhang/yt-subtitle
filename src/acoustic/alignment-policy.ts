import type { AlignmentMode, SubtitleLine } from "../shared/types";
import type { JobKey, TimeRange } from "./contracts";
export interface AlignmentProgress {
  key: JobKey;
  mode?: AlignmentMode;
  generation: number;
  sequence: number;
  lines: SubtitleLine[];
  checked: TimeRange[];
  ready: TimeRange[];
  phase:
    | "loading"
    | "buffering"
    | "running"
    | "complete"
    | "partial"
    | "failed"
    | "cancelled";
  error?: string;
}
/** Search actual endpoint-bounded gaps; no lyric duration is guessed. */
export function missingAudioRanges(
  lines: SubtitleLine[],
  durationMs: number,
): TimeRange[] {
  const gaps: TimeRange[] = [];
  let edge = 0,
    pending = false,
    startMs = 0;
  const add = (endMs: number) => {
    for (let at = startMs; at < endMs; at += 24000)
      gaps.push({ startMs: at, endMs: Math.min(endMs, at + 26000) });
  };
  for (const line of lines) {
    if (line.excluded) continue;
    if (line.startMs !== undefined && line.endMs !== undefined) {
      if (pending) add(Math.min(durationMs, line.startMs));
      edge = Math.max(edge, line.endMs);
      pending = false;
    } else {
      if (!pending) {
        startMs = Math.max(edge, line.startMs ?? 0);
        pending = true;
      }
      if (line.endMs !== undefined) {
        add(Math.min(durationMs, line.endMs));
        edge = Math.max(edge, line.endMs);
        pending = false;
      }
    }
  }
  if (pending) add(durationMs);
  return gaps;
}
export function createAlignmentPolicy(mode: AlignmentMode, durationMs: number) {
  const covered = (range: TimeRange, ready: TimeRange[]) =>
    ready.some((r) => r.startMs <= range.startMs && r.endMs >= range.endMs);
  return {
    target: (positionMs: number, first: boolean) => ({
      startMs: positionMs,
      endMs: Math.min(durationMs, positionMs + (first ? 15000 : 30000)),
    }),
    needsBuffer: (positionMs: number, ready: TimeRange[]) =>
      !covered(
        { startMs: positionMs, endMs: Math.min(durationMs, positionMs + 3000) },
        ready,
      ),
    nextRanges(positionMs: number, ready: TimeRange[]) {
      const ranges: TimeRange[] = [];
      const currentStart = Math.floor(positionMs / 24000) * 24000;
      for (let startMs = 0; startMs < durationMs; startMs += 24000)
        ranges.push({ startMs, endMs: Math.min(durationMs, startMs + 26000) });
      return ranges
        .filter((r) => !covered(r, ready))
        .sort((a, b) =>
          mode === "complete-before-use"
            ? a.startMs - b.startMs
            : (a.startMs >= currentStart ? 0 : 1) -
                (b.startMs >= currentStart ? 0 : 1) || a.startMs - b.startMs,
        );
    },
    mayPublish: (progress: AlignmentProgress) =>
      mode !== "complete-before-use" || progress.phase === "complete",
  };
}
