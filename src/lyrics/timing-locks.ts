import type {
  AlignedLine,
  SubtitleLine,
  TimingEndpoint,
} from "../shared/types";

/** Normalize projections and lock source endpoints without touching text. */
export function lockTiming(
  line: AlignedLine,
  durationMs: number,
): SubtitleLine {
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    throw new Error("影片長度無效");
  const timing = structuredClone(line.timing ?? {});
  const valid = (v: number | undefined, end: boolean): v is number =>
    v !== undefined &&
    Number.isFinite(v) &&
    v >= 0 &&
    (end ? v > 0 && v <= durationMs : v < durationMs);
  const start = line.startMs,
    end = line.endMs;
  const conflict = start !== undefined && end !== undefined && end <= start;
  const origin = line.status === "manual" ? "manual" : "source";
  if (
    conflict ||
    (start !== undefined && !valid(start, false)) ||
    (end !== undefined && !valid(end, true))
  )
    timing.rejected = {
      ...timing.rejected,
      ...(start !== undefined ? { startMs: start } : {}),
      ...(end !== undefined ? { endMs: end } : {}),
    };
  timing.start =
    !conflict && valid(start, false)
      ? { valueMs: start, origin: timing.start?.origin ?? origin, locked: true }
      : undefined;
  timing.end =
    !conflict && valid(end, true)
      ? { valueMs: end, origin: timing.end?.origin ?? origin, locked: true }
      : undefined;
  const complete = !!timing.start && !!timing.end;
  return {
    ...line,
    timing,
    startMs: timing.start?.valueMs,
    endMs: timing.end?.valueMs,
    status: complete
      ? line.status === "unaligned"
        ? "anchor"
        : line.status
      : "unaligned",
  };
}

export function mergeTiming(
  source: SubtitleLine,
  inferred: { startMs?: number; endMs?: number },
  durationMs: number,
): SubtitleLine {
  const startMs = source.startMs ?? inferred.startMs,
    endMs = source.endMs ?? inferred.endMs;
  if (
    startMs === undefined ||
    endMs === undefined ||
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs < 0 ||
    endMs <= startMs ||
    endMs > durationMs
  )
    return source;
  if (source.startMs !== undefined && source.endMs !== undefined) return source;
  const model = (valueMs: number): TimingEndpoint => ({
    valueMs,
    origin: "model",
    locked: true,
  });
  return {
    ...source,
    startMs,
    endMs,
    status: "estimated",
    timing: {
      ...source.timing,
      start: source.timing.start ?? model(startMs),
      end: source.timing.end ?? model(endMs),
    },
  };
}
