/** Fewer lines than this is not a song worth aligning. */
export const MIN_LYRIC_LINES = 4;
/** Lyric lines of a candidate, without LRC or SRT timing syntax. */
export function lyricLines(text: string | null | undefined) {
  return (text ?? "")
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*(?:\[[^\]]*\]\s*)+/u, "").trim())
    .filter((line) => line && !/^\d+$/u.test(line) && !line.includes("-->"));
}
