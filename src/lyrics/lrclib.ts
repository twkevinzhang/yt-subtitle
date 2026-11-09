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
const MAX_CANDIDATES = 5;
const NOISE =
  /\b(?:official(?:\s+(?:music\s+)?video)?|music\s+video|lyric\s+video|lyrics?|full\s*ver\.?|mv|hd|4k)\b/giu;

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
  return [
    ...new Set([cleaned, afterArtist, ...quoted].filter((q) => q.length >= 2)),
  ].slice(0, 3);
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
  const candidates: LyricCandidate[] = [...found.values()]
    .filter(
      (t) =>
        !t.instrumental &&
        typeof t.duration === "number" &&
        (!seconds ||
          Math.abs(t.duration - seconds) <= DURATION_TOLERANCE_SECONDS),
    )
    .sort(
      (a, b) =>
        Math.abs(a.duration! - seconds) - Math.abs(b.duration! - seconds),
    )
    .flatMap((t) => {
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
          matchReason: `長度 ${Math.round(t.duration!)} 秒，與影片相差 ${Math.abs(Math.round(t.duration! - seconds))} 秒`,
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
