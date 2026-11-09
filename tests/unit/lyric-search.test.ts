import { it, expect } from "vitest";
import {
  parseSearchReply,
  searchMessages,
  validateCandidates,
} from "../../src/lyrics/search";
import { lyricLines } from "../../src/lyrics/preview";

const evidence = { status: "unverified" as const, citations: [] };
const base = {
  title: "Lemon",
  artist: "米津玄師",
  version: "原曲",
  language: "ja",
  sourceId: "web",
  url: "https://lyrics.example/lemon",
  syncedLyrics: null,
  matchReason: "歌名與演唱者相符",
};
const text = (n: number) =>
  Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");
const candidates = (...items: object[]) => ({
  candidates: items.map((item, i) => ({ id: String(i + 1), ...base, ...item })),
});

it("offers only candidates that carry lyric text to align", () => {
  const result = validateCandidates(
    candidates(
      { fullText: text(12) },
      { fullText: null },
      { fullText: text(2) },
      { fullText: "", syncedLyrics: null },
    ),
    evidence,
    "web",
  );
  expect(result.map((c) => c.id)).toEqual(["1"]);
});
it("counts LRC and SRT lyrics by their text lines, not timing syntax", () => {
  const lrc = "[00:01.00] a\n[00:02.00] b\n[00:03.00] c\n[00:04.00] d\n";
  expect(lyricLines(lrc)).toEqual(["a", "b", "c", "d"]);
  const srt =
    "1\n00:00:01,000 --> 00:00:02,000\nhello\n\n2\n00:00:02,000 --> 00:00:03,000\nworld";
  expect(lyricLines(srt)).toEqual(["hello", "world"]);
  const result = validateCandidates(
    candidates({ fullText: null, syncedLyrics: lrc }),
    evidence,
    "web",
  );
  expect(result).toHaveLength(1);
});
it("explains when pages were found but none had lyrics", () => {
  const reply = JSON.stringify(candidates({ fullText: null }));
  const result = parseSearchReply(reply, evidence, "web");
  expect(result.candidates).toEqual([]);
  expect(result.error).toContain("歌詞全文");
});
it("keeps the model's own explanation when it returns no candidates", () => {
  const reply = JSON.stringify({ candidates: [], error: "只找到百科頁面" });
  expect(parseSearchReply(reply, evidence, "web").error).toBe("只找到百科頁面");
});
it("tells the model to read lyric pages and to skip pages without lyrics", () => {
  const [system, user] = searchMessages(
    {
      schemaVersion: 1,
      videoId: "abcdefghijk",
      title: "米津玄師 - Lemon",
      channel: "Kenshi Yonezu",
      description: "",
      durationMs: 274000,
    },
    "web",
  );
  expect(system!.content).toContain("歌詞全文");
  expect(system!.content).toContain("fullText");
  expect(system!.content).toContain("百科");
  expect(system!.content).toContain("不得依記憶補寫");
  // The task is repeated in the user message for gateways that drop `system`.
  expect(user!.content).toContain("歌詞全文");
  expect(user!.content).toContain('"videoId":"abcdefghijk"');
  expect(user!.content).toContain('"candidates":[]');
});

it("shows the model's own words when it ignores the reply format", () => {
  const prose =
    "This is metadata for Kenshi Yonezu's Lemon. What would you like me to do with it?";
  const result = parseSearchReply(prose, evidence, "web");
  expect(result.candidates).toEqual([]);
  expect(result.error).toContain("AI 沒有照指定格式回覆");
  expect(result.error).toContain("What would you like me to do with it?");
  expect(parseSearchReply("", evidence, "web").error).toContain("沒有內容");
});
