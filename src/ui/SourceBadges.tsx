import type { LyricCandidate } from "../shared/types";
import { lyricLines, MIN_LYRIC_LINES } from "../lyrics/preview";
import type { SearchRoute } from "../background/search-group";
export function candidateBrand(candidate: LyricCandidate, route: SearchRoute) {
  if (route === "lrclib") return { name: "LRCLIB" };
  if (route === "comments") return { name: "YouTube" };
  try {
    return { name: new URL(candidate.url).hostname };
  } catch {
    return { name: "來源網站" };
  }
}
export const routeNames: Record<SearchRoute, string> = {
  lrclib: "LRCLIB",
  comments: "YouTube",
  web: "Google",
};
/** Candidates with lyric text to align; results saved by older builds may have none. */
export function usableCandidates(candidates: readonly LyricCandidate[] = []) {
  return candidates.filter(
    (c) => lyricLines(c.syncedLyrics ?? c.fullText).length >= MIN_LYRIC_LINES,
  );
}
