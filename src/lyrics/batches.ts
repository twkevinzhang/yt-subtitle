import type { AlignedLine, Cue } from "../shared/types";
export interface AlignmentBatch {
  lines: AlignedLine[];
  cues: Cue[];
  context?: Array<{ id: string; original: string }>;
}
export function prepareAlignmentRetry(lines: AlignedLine[]): AlignedLine[] {
  const retrying = lines.some(
    (line) => !line.excluded && line.status === "unaligned",
  );
  return lines.map((line) =>
    retrying && line.status !== "manual" && !line.excluded
      ? {
          ...line,
          startMs: undefined,
          endMs: undefined,
          status: "unaligned",
          cueIds: [],
        }
      : line,
  );
}
export function makeBatches(
  lines: AlignedLine[],
  cues: Cue[],
): AlignmentBatch[] {
  // Keep full caption context so repeated choruses can be disambiguated across lyric batches.
  const batches: AlignmentBatch[] = [];
  for (let i = 0; i < lines.length; i += 40)
    batches.push({
      lines: lines.slice(i, i + 40),
      cues,
      context: lines.map(({ id, original }) => ({ id, original })),
    });
  return batches;
}
