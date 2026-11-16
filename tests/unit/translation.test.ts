import { it, expect } from "vitest";
import {
  decideTranslation,
  orderedLanguages,
  userLanguage,
} from "../../src/shared/translation";
import {
  chunkLines,
  parseTranslation,
  translateInChunks,
  translationMessages,
} from "../../src/lyrics/translate";
import { DEFAULT_TRANSLATION_INSTRUCTION } from "../../src/lyrics/default-prompts";
import { preferencesSchema } from "../../src/shared/schemas";

it("reads the user's language from the browser tag, falling back to English", () => {
  expect(userLanguage("zh-TW")).toBe("zh-Hant");
  expect(userLanguage("zh-CN")).toBe("zh-Hans");
  expect(userLanguage("zh-Hans-SG")).toBe("zh-Hans");
  expect(userLanguage("ja-JP")).toBe("ja");
  expect(userLanguage("sv-SE")).toBe("en");
});
it("lists the user's language first, then the rest in order", () => {
  const codes = orderedLanguages("ja").map((l) => l.code);
  expect(codes[0]).toBe("ja");
  expect(codes).toHaveLength(10);
  expect(codes.slice(1)).not.toContain("ja");
});
it("asks only when the lyrics are in another language than the user's", () => {
  expect(decideTranslation(undefined, "en", "zh-Hant")).toEqual({
    kind: "ask",
    language: "zh-Hant",
  });
  expect(decideTranslation(undefined, "zh", "zh-Hant")).toEqual({
    kind: "skip",
  });
});
it("never asks again after 'always' or 'never'", () => {
  const always = {
    ask: "always",
    display: "bilingual",
    language: "ja",
  } as const;
  expect(decideTranslation(always, "en", "zh-Hant")).toEqual({
    kind: "run",
    language: "ja",
  });
  expect(decideTranslation(always, "ja", "zh-Hant")).toEqual({ kind: "skip" });
  expect(
    decideTranslation({ ask: "never", display: "bilingual" }, "en", "zh-Hant"),
  ).toEqual({ kind: "skip" });
});
it("keeps the fixed reply format whatever instruction is saved", () => {
  const [system, user] = translationMessages("自訂指示", "ja", ["a", "b"]);
  expect(system!.content).toContain("自訂指示");
  expect(system!.content).not.toContain("逐行翻譯");
  expect(system!.content).toContain('"translations"');
  expect(user!.content).toContain("日本語");
  expect(user!.content).toContain('"lines":["a","b"]');
  expect(translationMessages(" ", "en", ["a"])[0]!.content).toContain(
    DEFAULT_TRANSLATION_INSTRUCTION,
  );
});
it("accepts one translation per line, even inside a code fence", () => {
  expect(
    parseTranslation('```json\n{"translations":[" x ","y"]}\n```', 2),
  ).toEqual(["x", "y"]);
});
it("rejects a refusal or a wrong line count instead of showing a bad translation", () => {
  expect(() =>
    parseTranslation("抱歉，我無法翻譯受版權保護的歌詞。", 2),
  ).toThrow("沒有照指定格式回覆：抱歉");
  expect(() => parseTranslation('{"translations":["x"]}', 2)).toThrow(
    "行數不符",
  );
});
it("loads saved preferences that have no translation block", () => {
  const old = {
    mode: "original",
    targetLanguage: "zh-Hant",
    fontSize: 28,
    position: "bottom",
  };
  expect(preferencesSchema.parse(old).translation).toBeUndefined();
  expect(
    preferencesSchema.safeParse({
      ...old,
      translation: { ask: "sometimes", display: "bilingual" },
    }).success,
  ).toBe(false);
});
it("splits lyrics into even parts of at most 20 lines", () => {
  const lines = Array.from({ length: 64 }, (_, i) => `l${i}`);
  expect(chunkLines(lines).map((c) => c.length)).toEqual([16, 16, 16, 16]);
  expect(chunkLines(lines.slice(0, 20))).toHaveLength(1);
  expect(chunkLines(lines.slice(0, 21)).map((c) => c.length)).toEqual([11, 10]);
  expect(chunkLines([])).toEqual([]);
});
it("sends the whole song as context only when it is split", () => {
  const [system, user] = translationMessages("x", "en", ["b"], ["a", "b"]);
  expect(system!.content).toContain("不要翻譯 context");
  expect(user!.content).toContain('"context":["a","b"]');
  expect(translationMessages("x", "en", ["b"])[1]!.content).not.toContain(
    "context",
  );
});
it("translates the parts in parallel and keeps the song's order", async () => {
  const lines = Array.from({ length: 45 }, (_, i) => `l${i}`);
  let running = 0,
    peak = 0;
  const result = await translateInChunks(
    lines,
    async (chunk, context) => {
      expect(context).toBe(lines);
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) =>
        setTimeout(resolve, chunk.length === 15 ? 5 : 1),
      );
      running--;
      return chunk.map((l) => l.toUpperCase());
    },
    new AbortController().signal,
  );
  expect(peak).toBe(3);
  expect(result).toEqual(lines.map((l) => l.toUpperCase()));
});
it("fails the whole translation and stops the other parts when one fails", async () => {
  const lines = Array.from({ length: 45 }, (_, i) => `l${i}`);
  const aborted: boolean[] = [];
  await expect(
    translateInChunks(
      lines,
      async (chunk, _context, signal) => {
        if (chunk[0] === "l0") throw new Error("AI 服務回應 HTTP 500");
        await new Promise((resolve) => setTimeout(resolve, 5));
        aborted.push(signal.aborted);
        return chunk;
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow("HTTP 500");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(aborted).toEqual([true, true]);
});
