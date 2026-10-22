import { it, expect } from "vitest";
import { parseSource } from "../../src/subtitle/parse-source";
import { validateSource } from "../../src/subtitle/result-validation";
it("preserves plain text, whitespace and language hint without invoking recognition", () => {
  expect(parseSource(" a \r\n\r\n a ", "en")).toEqual({
    rawText: " a \r\n\r\n a ",
    languageHint: "en",
  });
});
it("uses explicit SRT times for every lyric line without rewriting text", () => {
  const source = parseSource("1\r\n00:00:01,000 --> 00:00:02,000\r\n a \r\nb");
  expect(source.rawText).toBe(" a \nb");
  expect(validateSource(source, 10).kind).toBe("complete");
});
it("rejects LRC missing ends, malformed SRT and over-duration SRT", () => {
  expect(() => parseSource("[00:01.00]a")).toThrow();
  expect(() => parseSource("1\n00:00:xx,000 --> 00:00:02,000\na")).toThrow();
  expect(
    validateSource(parseSource("1\n00:00:01,000 --> 00:00:20,000\na"), 10).kind,
  ).toBe("invalid");
});
