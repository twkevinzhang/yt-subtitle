import { it, expect } from "vitest";
import { detectLanguage } from "../../src/subtitle/language";

it("treats any kana as Japanese even when kanji and Latin letters are mixed in", () => {
  expect(detectLanguage(["吊り上がった視界から覗く"])).toBe("ja");
  expect(
    detectLanguage(["You better fuckin' switch", "新しい生き方へと"]),
  ).toBe("ja");
  expect(detectLanguage(["ネオ"])).toBe("ja");
});
it("treats ideograph-heavy text without kana as Chinese", () => {
  expect(detectLanguage(["我們都是這樣長大的"])).toBe("zh");
});
it("defaults to English", () => {
  expect(detectLanguage(["We're no strangers to love"])).toBe("en");
  expect(detectLanguage([""])).toBe("en");
  expect(detectLanguage(["Hello 世界 world and more words"])).toBe("en");
});
