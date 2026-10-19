import type { AlignedLine } from "../shared/types";
import {
  assertJobKey,
  type AlignmentSnapshot,
  type JobKey,
  type Segment,
  type SegmentResult,
} from "./contracts";
import { validateSegment } from "./validate-segment";
export function createSnapshot(
  key: JobKey,
  lines: AlignedLine[],
  segments: Segment[],
): AlignmentSnapshot {
  return {
    key: { ...key },
    sequence: 0,
    lines: structuredClone(lines),
    segments: Object.fromEntries(
      segments.map((s) => [s.id, "pending" as const]),
    ),
    modelState: "unloaded",
  };
}
export function mergeSegment(
  snapshot: AlignmentSnapshot,
  result: SegmentResult,
  segments: Segment[],
): AlignmentSnapshot {
  try {
    assertJobKey(snapshot.key, result.key);
  } catch {
    return snapshot;
  }
  if (
    !Number.isSafeInteger(result.sequence) ||
    result.sequence <= snapshot.sequence
  )
    return snapshot;
  const segment = segments.find((s) => s.id === result.segmentId);
  if (
    !segment ||
    snapshot.segments[segment.id] === "verified" ||
    !validateSegment(result.lines, segment, snapshot.lines).ok
  )
    return snapshot;
  const map = new Map(result.lines.map((l) => [l.id, l]));
  return {
    ...snapshot,
    sequence: result.sequence,
    lines: snapshot.lines.map((l) => map.get(l.id) ?? l),
    segments: { ...snapshot.segments, [segment.id]: "verified" },
  };
}
