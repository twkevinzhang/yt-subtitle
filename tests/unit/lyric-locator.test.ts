import { it, expect } from "vitest";
import { matchLyricWindow } from "../../src/acoustic/lyric-locator";
import { normalizeSubtitle } from "../../src/lyrics/subtitle-source";
const lines = (text: string) =>
  normalizeSubtitle(text, { kind: "paste" }, 120000);
it("locates a unique ordered passage without altering lyrics", () => {
  const input = lines("first verse\nhello world\nlast verse");
  expect(
    matchLyricWindow(input, "first verse hello world", {
      startMs: 0,
      endMs: 20000,
    }).segments[0].lineIds,
  ).toEqual(["l0", "l1"]);
  expect(input[0].startMs).toBeUndefined();
});
it("refuses identical choruses without context rather than choosing another occurrence", () => {
  const input = lines("hello world\nunique bridge\nhello world");
  expect(
    matchLyricWindow(input, "hello world", { startMs: 30000, endMs: 50000 })
      .segments,
  ).toEqual([]);
  expect(
    matchLyricWindow(input, "unique bridge hello world", {
      startMs: 30000,
      endMs: 50000,
    }).segments[0].lineIds,
  ).toEqual(["l1", "l2"]);
});
it("uses neighboring locked times and does not overwrite them", () => {
  const input = lines(
    "1\n00:00:00,000 --> 00:00:02,000\nfirst\n\n2\n00:00:05,000 --> 00:00:07,000\nlast",
  );
  expect(
    matchLyricWindow(input, "first last", { startMs: 0, endMs: 10000 })
      .segments,
  ).toEqual([]);
});
it("allows recognition typos with strong passage coverage while refusing unrelated speech", () => {
  const input = lines(
    "you still stuck deep in that suneo ism\nyou better switch to the neo ism",
  );
  expect(
    matchLyricWindow(
      input,
      "you still stuck deep in the suneo ism you better switch to the neo ism",
      { startMs: 0, endMs: 20000 },
    ).segments[0].lineIds,
  ).toEqual(["l0", "l1"]);
  expect(
    matchLyricWindow(input, "a completely unrelated weather forecast", {
      startMs: 0,
      endMs: 20000,
    }).segments,
  ).toEqual([]);
});
import { locateLyrics } from "../../src/acoustic/lyric-locator";
import { RangeAudioSource } from "../../src/acoustic/progressive-audio-source";
it("refuses three identical choruses and unmatched kana readings without fabricating timestamps", () => {
  const repeated = lines(
    "hello world\nfirst bridge\nhello world\nsecond bridge\nhello world",
  );
  expect(
    matchLyricWindow(repeated, "hello world", { startMs: 50000, endMs: 76000 })
      .segments,
  ).toEqual([]);
  const japanese = lines("君の声が聞こえる\n（I can hear your voice）");
  const before = structuredClone(japanese);
  expect(
    matchLyricWindow(japanese, "きみのこえがきこえる", {
      startMs: 0,
      endMs: 20000,
    }).segments,
  ).toEqual([]);
  expect(japanese).toEqual(before);
});
it("only marks an empty transcript as silent when PCM also has silence evidence", async () => {
  for (const value of [0, 0.2]) {
    const audio = new RangeAudioSource(1000, () => {});
    audio.append({
      generation: 0,
      startMs: 0,
      sampleRate: 16000,
      pcm: new Float32Array(16000).fill(value),
    });
    const found = await locateLyrics(
      lines("unmatched"),
      { startMs: 0, endMs: 1000 },
      audio,
      { transcribe: async () => "" },
      new AbortController().signal,
    );
    expect(found.silent.length).toBe(value === 0 ? 1 : 0);
    audio.dispose();
  }
});
it("keeps a timed chorus as competing evidence instead of locating a later untimed repeat", () => {
  const input = lines("hello world\nunique bridge\nhello world");
  input[0] = { ...input[0], status: "anchor", startMs: 1000, endMs: 4000 };
  const result = matchLyricWindow(input, "hello world", {
    startMs: 0,
    endMs: 26000,
  });
  expect(result.segments).toEqual([]);
  expect(result.ambiguousLineIds).toContain("l2");
});
it("rechecks a failed automatic language detection with the script of untimed lyrics, without a lyric prompt", async () => {
  const audio = new RangeAudioSource(1000, () => {});
  audio.append({
    generation: 0,
    startMs: 0,
    sampleRate: 16000,
    pcm: new Float32Array(16000).fill(0.2),
  });
  const calls: any[] = [];
  const input = lines("ありあまるメルセデスベンツ\n泣く子も黙るブレぬセンス");
  const result = await locateLyrics(
    input,
    { startMs: 0, endMs: 1000 },
    audio,
    {
      transcribe: async (request) => {
        calls.push(request);
        return request.language === "ja"
          ? "ありあまるメルセデスベンツ 泣く子も黙るブレぬセンス"
          : "the more I talk about the more I talk about";
      },
    },
    new AbortController().signal,
  );
  expect(result.segments).toHaveLength(1);
  expect(calls.map((c) => c.language)).toEqual(["auto", "ja"]);
  expect(
    calls.every((c) => Object.keys(c).sort().join() === "language,pcm"),
  ).toBe(true);
  audio.dispose();
});
it("locates a unique complete lyric inside a noisy transcript without assigning time to its neighbors", () => {
  const input = lines(
    "とんがった口先じゃ何か言ったところで\n世界はイビツで\n鼻につく革靴\n治ればまた靴擦れ",
  );
  const result = matchLyricWindow(
    input,
    "トンガーたくつさきじゃなに描いたところで ツリー上がったしっかりからの属 世界はイビツで 花につくかわくつ な俺ばまたくつずれ",
    { startMs: 24000, endMs: 50000 },
  );
  expect(result.segments.map((s) => s.lineIds)).toEqual([["l1"]]);
  expect(result.contexts?.[result.segments[0].id]?.leadingText).toContain(
    "トンガー",
  );
  expect(result.contexts?.[result.segments[0].id]?.trailingText).toContain(
    "花につく",
  );
  expect(input.every((l) => l.startMs === undefined)).toBe(true);
  expect(
    matchLyricWindow(
      lines("世界はイビツで\nunique verse\n世界はイビツで"),
      "unrelated noise 世界はイビツで more noise",
      { startMs: 0, endMs: 26000 },
    ).segments,
  ).toEqual([]);
  expect(
    matchLyricWindow(lines("本日も"), "noise 本日も noise", {
      startMs: 0,
      endMs: 26000,
    }).segments,
  ).toEqual([]);
});
it("keeps the audio window of recognized context intact around neighboring source locks", () => {
  const input = lines("known before\n世界はイビツで\nknown after");
  input[0] = { ...input[0], startMs: 0, endMs: 10000, status: "anchor" };
  input[2] = { ...input[2], startMs: 20000, endMs: 26000, status: "anchor" };
  const result = matchLyricWindow(
    input,
    "あ".repeat(30) + "世界はイビツで" + "う".repeat(30),
    { startMs: 0, endMs: 26000 },
  );
  expect(result.segments[0]).toMatchObject({ startMs: 0, endMs: 26000 });
});
