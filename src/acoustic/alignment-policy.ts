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
      for (let startMs = 0; startMs < durationMs; startMs += 24000)
        ranges.push({ startMs, endMs: Math.min(durationMs, startMs + 26000) });
      return ranges
        .filter((r) => !covered(r, ready))
        .sort((a, b) =>
          mode === "complete-before-use"
            ? a.startMs - b.startMs
            : (a.endMs > positionMs ? 0 : 1) - (b.endMs > positionMs ? 0 : 1) ||
              Math.abs(a.startMs - positionMs) -
                Math.abs(b.startMs - positionMs),
        );
    },
    mayPublish: (progress: AlignmentProgress) =>
      mode !== "complete-before-use" || progress.phase === "complete",
  };
}
