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
