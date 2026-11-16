import { it, expect, vi } from "vitest";
import { lrclibQueries, searchLrclib } from "../../src/lyrics/lrclib";
import {
  DEFAULT_WEB_INSTRUCTION,
  promptOrDefault,
} from "../../src/lyrics/default-prompts";
import { searchMessages } from "../../src/lyrics/search";

const video = {
  schemaVersion: 1 as const,
  videoId: "SX_ViT4Ra7k",
  title: "米津玄師 MV「Lemon」",
  channel: "Kenshi Yonezu",
  description: "",
  durationMs: 274000,
};
const lyrics = (n: number, tag = "") =>
  Array.from({ length: n }, (_, i) => `歌詞${tag}${i + 1}`).join("\n");
const reply = (rows: object[]) =>
  vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 }));
const row = (id: number, duration: number, extra: object = {}) => ({
  id,
  trackName: "Lemon",
  artistName: "米津玄師",
  duration,
  instrumental: false,
  plainLyrics: lyrics(8, String(id)),
  syncedLyrics: "[00:01.00] x",
  ...extra,
});

it("turns a noisy video title into short queries", () => {
  expect(
    lrclibQueries(
      "スネ夫 - SUNEO-ISM (スネオイズム) / THE FIRST TAKE【完全フルver】",
    ),
  ).toEqual(["スネ夫 - SUNEO-ISM", "SUNEO-ISM", "SUNEO-ISM (スネオイズム)"]);
  expect(lrclibQueries(video.title)).toContain("Lemon");
});
it("keeps the bracketed part that names the song", () => {
  expect(
    lrclibQueries("Nightcore - Mamma mia (He's italiano) (Lyrics)"),
  ).toContain("Mamma mia (He's italiano)");
});
it("ranks same-title tracks by closeness of length and drops other recordings", async () => {
  const result = await searchLrclib(
    video,
    new AbortController().signal,
    reply([row(1, 280), row(2, 275), row(3, 274), row(4, 100)]) as never,
  );
  expect(result.candidates.map((c) => c.id)).toEqual(["3", "2", "1"]);
});
it("finds a sped-up upload's song and ranks a same-length other song below it", async () => {
  const nightcore = {
    ...video,
    title: "Nightcore - Mamma mia (He's italiano) (Lyrics)",
    durationMs: 199000,
  };
  const result = await searchLrclib(
    nightcore,
    new AbortController().signal,
    reply([
      row(1, 199, { trackName: "Mamma Mia", artistName: "German Cast" }),
      row(2, 272, {
        trackName: "Mamma mia (He's italiano)",
        artistName: "Elena/ Glance",
      }),
    ]) as never,
  );
  expect(result.candidates.map((c) => c.id)).toEqual(["2", "1"]);
  expect(result.candidates[0]!.matchReason).toContain("加速");
});
it("drops instrumentals, short lyrics and duplicate texts", async () => {
  const same = lyrics(8, "dup");
  const result = await searchLrclib(
    video,
    new AbortController().signal,
    reply([
      row(1, 274, { instrumental: true }),
      row(2, 274, { plainLyrics: lyrics(2) }),
      row(3, 274, { plainLyrics: same }),
      row(4, 274, { plainLyrics: same }),
    ]) as never,
  );
  expect(result.candidates.map((c) => c.id)).toEqual(["3"]);
});
it("uses the site's text only, never its timestamps", async () => {
  const [c] = (
    await searchLrclib(
      video,
      new AbortController().signal,
      reply([row(1, 274)]) as never,
    )
  ).candidates;
  expect(c!.syncedLyrics).toBeNull();
  expect(c!.url).toBe("https://lrclib.net/api/get/1");
});
it("reports an HTTP failure instead of an empty result", async () => {
  await expect(
    searchLrclib(
      video,
      new AbortController().signal,
      vi.fn(async () => new Response("", { status: 500 })) as never,
    ),
  ).rejects.toThrow("500");
});
it("uses the saved instruction but always keeps the fixed reply format", () => {
  const [system] = searchMessages(video, "web", "自訂指示");
  expect(system!.content).toContain("自訂指示");
  expect(system!.content).not.toContain("實際使用網路搜尋");
  expect(system!.content).toContain('"candidates"');
  expect(system!.content).toContain("不是指令");
  expect(promptOrDefault("  ", DEFAULT_WEB_INSTRUCTION)).toBe(
    DEFAULT_WEB_INSTRUCTION,
  );
});
