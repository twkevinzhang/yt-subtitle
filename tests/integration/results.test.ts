import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import {
  saveResult,
  listResults,
  clearResults,
  hashInput,
} from "../../src/background/results";
it("preserves independent results and excludes credentials", async () => {
  await clearResults();
  const base = {
    schemaVersion: 1 as const,
    key: {
      schemaVersion: 1 as const,
      videoId: "12345678901",
      inputHash: "a",
      targetLanguage: "zh-Hant" as const,
    },
    videoDurationMs: 3000,
    source: { kind: "user" as const },
    lines: [
      {
        id: "l",
        original: "歌",
        cueIds: [],
        status: "manual" as const,
        excluded: false,
        startMs: 0,
        endMs: 1000,
      },
    ],
    offsetMs: 0,
    model: "m",
    createdAt: 1,
    updatedAt: 1,
  };
  await saveResult(base);
  await saveResult({ ...base, key: { ...base.key, inputHash: "b" } });
  expect(await listResults(base.key.videoId)).toHaveLength(2);
  await expect(
    saveResult({ ...base, apiToken: "leak" } as any),
  ).rejects.toThrow();
});
it("hash changes when target text changes", async () =>
  expect(await hashInput({ a: "one" })).not.toBe(
    await hashInput({ a: "two" }),
  ));
it("hash is independent of object property ordering at validation boundaries", async () =>
  expect(await hashInput({ b: 2, a: 1 })).toBe(
    await hashInput({ a: 1, b: 2 }),
  ));
