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
it("selects the lyric script explicitly without a lyric prompt or an English-default attempt", async () => {
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
  expect(calls.map((c) => c.language)).toEqual(["ja"]);
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
it("resolves a repeated chorus only when locked neighbors exclude its other occurrence", () => {
  const input = lines("hello world\nbridge\nhello world\nending");
  input[1] = { ...input[1], startMs: 30000, endMs: 34000, status: "manual" };
  input[3] = { ...input[3], startMs: 60000, endMs: 64000, status: "manual" };
  const before = structuredClone(input);
  expect(
    matchLyricWindow(input, "hello world", {
      startMs: 40000,
      endMs: 56000,
    }).segments.map((s) => s.lineIds),
  ).toEqual([["l2"]]);
  expect(input).toEqual(before);
});
it("ignores an impossible repeat when matching an exact anchor inside noisy speech", () => {
  const input = lines("世界はイビツで\nbridge\n世界はイビツで\nending");
  input[1] = { ...input[1], startMs: 30000, endMs: 34000, status: "manual" };
  input[3] = { ...input[3], startMs: 60000, endMs: 64000, status: "manual" };
  expect(
    matchLyricWindow(
      input,
      "あ".repeat(40) + "世界はイビツで" + "う".repeat(40),
      { startMs: 40000, endMs: 56000 },
    ).segments.map((s) => s.lineIds),
  ).toEqual([["l2"]]);
});
it("recognizes a bounded full line with ASR substitutions inside unrelated context", () => {
  const input = lines("first\n家に帰っても「おかえり」はないよ\nlast");
  input[0] = { ...input[0], startMs: 30000, endMs: 34000, status: "manual" };
  input[2] = { ...input[2], startMs: 60000, endMs: 64000, status: "manual" };
  const observed =
    "あ".repeat(35) + "家に帰ってもう帰りはないよ" + "う".repeat(35);
  const found = matchLyricWindow(input, observed, {
    startMs: 40000,
    endMs: 56000,
  });
  expect(found.segments.map((s) => s.lineIds)).toEqual([["l1"]]);
  expect(found.contexts?.[found.segments[0].id]).toEqual({
    leadingText: "あ".repeat(35),
    trailingText: "う".repeat(35),
  });
  expect(
    matchLyricWindow(input, "天気予報によると明日は全国的に雨の見込みです", {
      startMs: 40000,
      endMs: 56000,
    }).segments,
  ).toEqual([]);
});
it("maps all repeated occurrences in order only when the bounded counts agree", () => {
  const input = lines(
    "You still stuck deep in that Suneo ism\n（translation）\nYou still stuck deep in that Suneo ism\nbridge",
  );
  input[3] = { ...input[3], startMs: 30000, endMs: 34000, status: "manual" };
  const chorus = "You still stuck deep in that Suneo ism";
  const found = matchLyricWindow(
    input,
    "intro " + chorus + " different speech " + chorus + " outro",
    { startMs: 0, endMs: 26000 },
  );
  expect(found.segments.map((s) => s.lineIds)).toEqual([["l0"], ["l2"]]);
  expect(
    matchLyricWindow(input, "intro " + chorus + " outro", {
      startMs: 0,
      endMs: 26000,
    }).segments,
  ).toEqual([]);
  expect(input[1].excluded).toBe(false);
});
it("checks both explicitly selected languages in a mixed English and Japanese window", async () => {
  const input = lines(
    "An entirely unique English verse\nあの日に戻りたいなんて言わない",
  );
  const audio = new RangeAudioSource(1000, () => {});
  audio.append({
    generation: 0,
    startMs: 0,
    sampleRate: 16000,
    pcm: new Float32Array(16000).fill(0.1),
  });
  const calls: string[] = [];
  const result = await locateLyrics(
    input,
    { startMs: 0, endMs: 1000 },
    audio,
    {
      transcribe: async (request) => {
        calls.push(request.language);
        return request.language === "en"
          ? input[0].original
          : input[1].original;
      },
    },
    new AbortController().signal,
  );
  expect(calls).toEqual(["ja", "en"]);
  expect(result.segments.flatMap((s) => s.lineIds)).toEqual(["l0", "l1"]);
  audio.dispose();
});
it("does not let an ambiguous chorus hide a different uniquely recognized line", () => {
  const input = lines(
    "hello world\nbridge\nhello world\nseparator\n世界はイビツで",
  );
  const found = matchLyricWindow(input, "hello world 世界はイビツで", {
    startMs: 0,
    endMs: 26000,
  });
  expect(found.segments.some((s) => s.lineIds.includes("l4"))).toBe(true);
  expect(found.segments.flatMap((s) => s.lineIds)).not.toContain("l0");
  expect(found.segments.flatMap((s) => s.lineIds)).not.toContain("l2");
});
it("jointly aligns recognized anchors with intervening ASR context while retaining single-anchor fallbacks", () => {
  const input = lines("世界はイビツで\n未辨識原文\n今も忘れちゃないぜ");
  const observed =
    "あ".repeat(35) +
    "世界はイビツで" +
    "う".repeat(35) +
    "今も忘れちゃないぜ" +
    "え".repeat(35);
  const found = matchLyricWindow(
    input,
    observed,
    { startMs: 0, endMs: 26000 },
    true,
  );
  expect(found.segments).toHaveLength(1);
  const joint = found.segments[0];
  expect(joint.lineIds).toEqual(["l0", "l2"]);
  expect(joint.contextLineIds).toHaveLength(1);
  const context = found.contexts?.[joint.id]!;
  expect(
    context.alignmentLines?.find((l) => joint.contextLineIds.includes(l.id))
      ?.original,
  ).toBe("う".repeat(35));
  expect(found.fallbacks?.[joint.id].map((s) => s.lineIds)).toEqual([
    ["l0"],
    ["l2"],
  ]);
  expect(input.every((l) => l.startMs === undefined && !l.excluded)).toBe(true);
});
it("uses local pronunciation equivalence without changing the supplied lyric text", async () => {
  const input = lines("君の声が聞こえる");
  const original = structuredClone(input);
  const audio = new RangeAudioSource(1000, () => {});
  audio.append({
    generation: 0,
    startMs: 0,
    sampleRate: 16000,
    pcm: new Float32Array(16000).fill(0.1),
  });
  const found = await locateLyrics(
    input,
    { startMs: 0, endMs: 1000 },
    audio,
    {
      transcribe: async () => "きみのこえがきこえる",
      readings: async (texts) =>
        texts.map((text) =>
          text === "君の声が聞こえる" ? "キミノコエガキコエル" : text,
        ),
    },
    new AbortController().signal,
  );
  expect(found.segments.flatMap((s) => s.lineIds)).toEqual(["l0"]);
  expect(input).toEqual(original);
  audio.dispose();
});
it("keeps neighboring fuzzy anchors when their ASR edit spans share one boundary character", () => {
  const input = lines(
    "ナオレバマタクツズレ\nネオンガテラスマチナガスホンジツモ",
  );
  const observed =
    "ア".repeat(35) +
    "ナオレワマタクツズレオトガテラスマチナカホンジツモ" +
    "ウ".repeat(35);
  const found = matchLyricWindow(
    input,
    observed,
    { startMs: 0, endMs: 26000 },
    true,
  );
  expect(found.segments.flatMap((s) => s.lineIds)).toEqual(["l0", "l1"]);
});
it("selects Japanese explicitly when English lyrics are outside the window according to locked times", async () => {
  const input = lines(
    "an English lyric that must not affect later windows\nanchor\n君の声が聞こえる",
  );
  Object.assign(input[1], { startMs: 10000, endMs: 12000, status: "anchor" });
  const audio = new RangeAudioSource(20000, () => {});
  audio.append({
    generation: 0,
    startMs: 0,
    sampleRate: 16000,
    pcm: new Float32Array(320000).fill(0.1),
  });
  const calls: string[] = [];
  await locateLyrics(
    input,
    { startMs: 12000, endMs: 20000 },
    audio,
    {
      transcribe: async ({ language }) => {
        calls.push(language);
        return "君の声が聞こえる";
      },
    },
    new AbortController().signal,
  );
  expect(calls).toEqual(["ja"]);
  audio.dispose();
});
it("uses short pronunciation evidence only within a gap bounded by two existing timestamps", () => {
  const input = lines("known before\nアイナキブレイモン\nknown after");
  Object.assign(input[0], { startMs: 0, endMs: 2000, status: "anchor" });
  Object.assign(input[2], { startMs: 5000, endMs: 7000, status: "anchor" });
  expect(
    matchLyricWindow(input, "アイナキブンデ", {
      startMs: 2000,
      endMs: 5000,
    }).segments.flatMap((s) => s.lineIds),
  ).toEqual(["l1"]);
  expect(
    matchLyricWindow(input, "アイナキブンデ", { startMs: 0, endMs: 7000 })
      .segments,
  ).toEqual([]);
  expect(
    matchLyricWindow(input, "アシタノテンキハアメデス", {
      startMs: 2000,
      endMs: 5000,
    }).segments,
  ).toEqual([]);
});
