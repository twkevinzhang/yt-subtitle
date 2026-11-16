import { z } from "zod";
import { detectLanguage } from "../subtitle/language";
import { lyricLines, MIN_LYRIC_LINES } from "./preview";
import type {
  LyricCandidate,
  LyricSearchResult,
  VideoContext,
} from "../shared/types";

const ENDPOINT = "https://lrclib.net/api/search";
/** Same recording within this many seconds of the video's length. */
const DURATION_TOLERANCE_SECONDS = 3;
/**
 * Sped-up, slowed or trimmed uploads change the length, so a different length
 * only ranks lower; beyond this ratio it is another recording altogether.
 */
const MAX_DURATION_RATIO = 1.6;
/** Title overlap needed for a track whose length does not match the video. */
const MIN_TITLE_SIMILARITY = 0.5;
const MATCHED_LENGTH_BONUS = 0.3;
const MAX_CANDIDATES = 5;
const NOISE =
  /\b(?:official(?:\s+(?:music\s+)?video)?|music\s+video|lyric\s+video|lyrics?|full\s*ver\.?|mv|hd|4k)\b/giu;
/** Words that describe the upload, not the song. */
const UPLOAD_WORDS = new Set([
  "nightcore",
  "sped",
  "slowed",
  "reverb",
  "audio",
  "ver",
  "version",
]);

const track = z.object({
  id: z.number(),
  trackName: z.string().nullish(),
  artistName: z.string().nullish(),
  duration: z.number().nullish(),
  instrumental: z.boolean().nullish(),
  plainLyrics: z.string().nullish(),
  syncedLyrics: z.string().nullish(),
});

const tidy = (s: string) => s.replace(/\s+/gu, " ").trim();

/** Search strings from a video title; the length filter does the real matching. */
export function lrclibQueries(title: string): string[] {
  const cleaned = tidy(
    title
      .replace(/[【\[][^】\]]*[】\]]/gu, " ")
      .replace(/[（(][^）)]*[）)]/gu, " ")
      .replace(/\s*[/|｜].*$/u, " ")
      .replace(NOISE, " "),
  );
  const quoted = [...title.matchAll(/[「『"“]([^」』"”]{1,80})[」』"”]/gu)].map(
    (m) => tidy(m[1]!),
  );
  const afterArtist = cleaned.includes(" - ")
    ? tidy(cleaned.split(" - ").slice(1).join(" - "))
    : "";
  // Brackets often carry the part that tells songs of one name apart.
  const kept = tidy(
    title
      .replace(/[【\[][^】\]]*[】\]]/gu, " ")
      .replace(/\s*[/|｜].*$/u, " ")
      .replace(NOISE, " ")
      .replace(/[（(]\s*[)）]/gu, " "),
  );
  const keptAfterArtist = kept.includes(" - ")
    ? tidy(kept.split(" - ").slice(1).join(" - "))
    : kept;
  return [
    ...new Set(
      [cleaned, afterArtist, keptAfterArtist, ...quoted].filter(
        (q) => q.length >= 2,
      ),
    ),
  ].slice(0, 4);
}

/** Latin words and digits stay whole; each CJK character counts on its own. */
function tokens(text: string): Set<string> {
  const found =
    text
      .toLowerCase()
      .replace(NOISE, " ")
      .replace(/\bsped\s*up\b/gu, " ")
      .match(
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+/gu,
      ) ?? [];
  return new Set(found.filter((t) => !UPLOAD_WORDS.has(t)));
}

/**
 * Share of words that the video title and the track have in common (Jaccard).
 * The artist counts only when the title names them, since many titles do not.
 */
export function titleSimilarity(
  videoTitle: string,
  trackName: string,
  artistName: string,
): number {
  const video = tokens(videoTitle);
  const track = tokens(trackName);
  for (const t of tokens(artistName)) if (video.has(t)) track.add(t);
  if (!video.size || !track.size) return 0;
  let shared = 0;
  for (const t of track) if (video.has(t)) shared++;
  return shared / (video.size + track.size - shared);
}

export async function searchLrclib(
  video: VideoContext,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<LyricSearchResult> {
  const seconds = video.durationMs / 1000;
  const found = new Map<number, z.infer<typeof track>>();
  const rows = await Promise.all(
    lrclibQueries(video.title).map(async (q) => {
      const response = await fetcher(`${ENDPOINT}?q=${encodeURIComponent(q)}`, {
        signal,
      });
      if (!response.ok) throw new Error(`LRCLIB 回應 ${response.status}`);
      return z.array(track).parse(await response.json());
    }),
  );
  for (const row of rows.flat()) found.set(row.id, row);
  const seen = new Set<string>();
  const ratio = (d: number) => Math.max(d, seconds) / Math.min(d, seconds);
  const ranked = [...found.values()].flatMap((t) => {
    if (t.instrumental || typeof t.duration !== "number") return [];
    const gap = Math.abs(t.duration - seconds);
    const sameLength = !seconds || gap <= DURATION_TOLERANCE_SECONDS;
    const similarity = titleSimilarity(
      video.title,
      t.trackName ?? "",
      t.artistName ?? "",
    );
    const sameSong =
      similarity >= MIN_TITLE_SIMILARITY &&
      ratio(t.duration) <= MAX_DURATION_RATIO;
    if (!sameLength && !sameSong) return [];
    return [
      {
        t,
        gap,
        score: similarity + (sameLength ? MATCHED_LENGTH_BONUS : 0),
        sameLength,
      },
    ];
  });
  const candidates: LyricCandidate[] = ranked
    .sort((a, b) => b.score - a.score || a.gap - b.gap)
    .flatMap(({ t, gap, sameLength }) => {
      const lines = lyricLines(t.plainLyrics ?? t.syncedLyrics);
      const key = lines.join("\n");
      if (lines.length < MIN_LYRIC_LINES || seen.has(key)) return [];
      seen.add(key);
      const url = `https://lrclib.net/api/get/${t.id}`;
      return [
        {
          schemaVersion: 1 as const,
          id: String(t.id),
          title: t.trackName ?? "",
          artist: t.artistName ?? "",
          language: detectLanguage(lines),
          version: `${Math.round(t.duration!)} 秒`,
          sourceId: "lrclib",
          url,
          // Only the text is used; the site's timestamps are never trusted.
          fullText: lines.join("\n"),
          syncedLyrics: null,
          matchReason: sameLength
            ? `長度 ${Math.round(t.duration!)} 秒，與影片相差 ${Math.round(gap)} 秒`
            : `歌名相符；長度 ${Math.round(t.duration!)} 秒，與影片相差 ${Math.round(gap)} 秒（可能是加速、慢速或剪輯版）`,
          evidence: {
            status: "verified" as const,
            citations: [url],
            toolEvidence: "lrclib-api",
          },
        },
      ];
    })
    .slice(0, MAX_CANDIDATES);
  return { text: "", candidates };
}
