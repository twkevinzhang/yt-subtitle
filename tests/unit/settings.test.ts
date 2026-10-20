import { it, expect } from "vitest";
import { preferencesSchema } from "../../src/shared/schemas";
it("migrates missing alignment mode and preserves explicit choices", () => {
  const preferences = {
    mode: "original",
    targetLanguage: "zh-Hant",
    fontSize: 28,
    position: "bottom",
  };
  expect(preferencesSchema.parse(preferences).alignmentMode).toBe(
    "buffer-before-play",
  );
  expect(
    preferencesSchema.parse({ ...preferences, alignmentMode: "background" })
      .alignmentMode,
  ).toBe("background");
  expect(() =>
    preferencesSchema.parse({ ...preferences, alignmentMode: "invalid" }),
  ).toThrow();
});
import {
  normalizeProvider,
  publicSettings,
  normalizeSources,
} from "../../src/background/settings";
const p = {
  schemaVersion: 1,
  baseUrl: "https://ai.test/v1///",
  apiToken: "secret",
  model: "m",
};
it("rejects blank token but accepts an unselected model for staged setup", () => {
  expect(() => normalizeProvider({ ...p, apiToken: "   " })).toThrow();
  const provider = normalizeProvider({ ...p, model: "   " });
  expect(provider.model).toBe("");
  expect(
    publicSettings({
      provider,
      sources: [],
      revision: 1,
      preferences: {
        mode: "original",
        fontSize: 28,
        position: "bottom",
        targetLanguage: "zh-Hant",
      },
    }).configured,
  ).toBe(false);
});
it("normalizes URL but rejects cleartext remote and partial CF", () => {
  expect(normalizeProvider(p).baseUrl).toBe("https://ai.test/v1");
  expect(() =>
    normalizeProvider({ ...p, baseUrl: "http://remote.test" }),
  ).toThrow();
  expect(() => normalizeProvider({ ...p, cfClientId: "id" })).toThrow();
});
it("does not expose provider credentials to content", () => {
  expect(
    JSON.stringify(
      publicSettings({
        provider: normalizeProvider(p),
        sources: [],
        revision: 2,
        preferences: {
          mode: "original",
          fontSize: 28,
          position: "bottom",
          targetLanguage: "zh-Hant",
        },
      }),
    ),
  ).not.toContain("secret");
});
it("rejects domains disguised as URLs", () =>
  expect(() =>
    normalizeSources([
      {
        schemaVersion: 1,
        id: "x",
        name: "x",
        domain: "example.com/path",
        enabled: true,
        includeSubdomains: false,
      },
    ]),
  ).toThrow());
