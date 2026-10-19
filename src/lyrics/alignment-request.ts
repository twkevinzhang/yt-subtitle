import type { AlignedLine, Cue } from "../shared/types";
import { alignmentMessages } from "./alignment";
import { prepareAlignmentRetry } from "./batches";
export function alignmentRequest(
  model: string,
  lines: AlignedLine[],
  cues: Cue[],
) {
  return {
    model,
    messages: alignmentMessages(
      { lines: prepareAlignmentRetry(lines), cues },
      "ja",
      false,
    ),
    stream: false as const,
  };
}
