import type {
  AlignedLine,
  LyricCandidate,
  SavedResult,
  TargetLanguage,
} from "../shared/types";
import { parseLyrics } from "./formats";
export interface DraftProvenance {
  source: SavedResult["source"];
  targetLanguage: TargetLanguage;
  model: string;
}
export function provenanceOf(result: SavedResult): DraftProvenance {
  return {
    source: { ...result.source },
    targetLanguage: result.key.targetLanguage,
    model: result.model,
  };
}
export function candidateDraft(
  candidate: LyricCandidate,
  durationMs: number,
): { lines: AlignedLine[]; text: string; raw: string } {
  const raw = candidate.syncedLyrics || candidate.fullText || "";
  return {
    text: candidate.fullText || "",
    raw,
    lines: raw
      ? parseLyrics(
          new TextEncoder().encode(raw),
          candidate.syncedLyrics ? "lrc" : "txt",
          durationMs,
        )
      : [],
  };
}
