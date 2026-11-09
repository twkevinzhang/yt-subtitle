import { it, expect } from "vitest";
import { parseModelJson } from "../../src/lyrics/model-json";

const answer = { candidates: [{ id: "1", fullText: "a\nb" }] };

it("reads plain and fenced JSON", () => {
  expect(parseModelJson(JSON.stringify(answer))).toEqual(answer);
  expect(
    parseModelJson("```json\n" + JSON.stringify(answer) + "\n```"),
  ).toEqual(answer);
});
it("ignores a sentence before or after the JSON", () => {
  const text = "找到了：\n" + JSON.stringify(answer) + "\n以上是結果。";
  expect(parseModelJson(text)).toEqual(answer);
});
it("accepts real line breaks inside string values", () => {
  const text = '{"candidates":[{"id":"1","fullText":"a\nb\r\nc\td"}]}';
  expect(parseModelJson(text)).toEqual({
    candidates: [{ id: "1", fullText: "a\nb\r\nc\td" }],
  });
});
it("keeps escapes and quotes that are already valid", () => {
  const text = '{"x":"she said \\"hi\\"\\n\\\\ok","y":"line1\nline2"}';
  expect(parseModelJson(text)).toEqual({
    x: 'she said "hi"\n\\ok',
    y: "line1\nline2",
  });
});
it("still rejects text that is not JSON at all", () => {
  expect(() => parseModelJson("沒有找到歌詞")).toThrow(SyntaxError);
  expect(() => parseModelJson('{"candidates": [')).toThrow(SyntaxError);
});
