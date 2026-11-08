import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import {
  createSubtitleCache,
  resultCacheKey,
} from "../../src/subtitle/cache-store";
import type {
  PreparedLyrics,
  ResultValidation,
} from "../../src/subtitle/types";

let n = 0;
const fresh = (options = {}) =>
  createSubtitleCache({ dbName: "cache-test-" + n++, ...options });
const pcm = (length: number, fill = 1) => new Int16Array(length).fill(fill);
const lyrics: PreparedLyrics = {
  rawText: "a\nb",
  lyrics: ["a", "b"],
  sourceLineIndexes: [0, 1],
};
const complete: ResultValidation = {
  kind: "complete",
  cues: [{ sourceLineIndex: 0, text: "a", startMs: 0, endMs: 1000 }],
};

it("returns stored audio for the same video and duration", async () => {
  const cache = fresh();
  await cache.putAudio("abcdefghijk", 213.06, pcm(8, 7));
  expect(Array.from((await cache.getAudio("abcdefghijk", 213.06))!)).toEqual(
    Array(8).fill(7),
  );
  expect(await cache.getAudio("abcdefghijk", 213.9)).toBeDefined();
});
it("misses for another video or a clearly different duration", async () => {
  const cache = fresh();
  await cache.putAudio("abcdefghijk", 213, pcm(8));
  expect(await cache.getAudio("zzzzzzzzzzz", 213)).toBeUndefined();
  expect(await cache.getAudio("abcdefghijk", 230)).toBeUndefined();
});
it("evicts the least recently used audio beyond the byte limit", async () => {
  let clock = 0;
  const cache = fresh({ maxAudioBytes: 40, now: () => ++clock });
  await cache.putAudio("aaaaaaaaaaa", 10, pcm(10)); // 20 bytes
  await cache.putAudio("bbbbbbbbbbb", 10, pcm(10)); // 40 bytes
  await cache.getAudio("aaaaaaaaaaa", 10); // a is now newer than b
  await cache.putAudio("ccccccccccc", 10, pcm(10)); // over limit: evict b
  expect(await cache.getAudio("aaaaaaaaaaa", 10)).toBeDefined();
  expect(await cache.getAudio("bbbbbbbbbbb", 10)).toBeUndefined();
  expect(await cache.getAudio("ccccccccccc", 10)).toBeDefined();
});
it("does not store audio larger than the whole limit", async () => {
  const cache = fresh({ maxAudioBytes: 10 });
  await cache.putAudio("abcdefghijk", 10, pcm(100));
  expect(await cache.getAudio("abcdefghijk", 10)).toBeUndefined();
});
it("keeps complete and incomplete results but never invalid ones", async () => {
  const cache = fresh();
  await cache.putResult("k1", complete);
  await cache.putResult("k2", { kind: "incomplete", lineIndexes: [1] });
  await cache.putResult("k3", { kind: "invalid", code: "X" });
  expect(await cache.getResult("k1")).toEqual(complete);
  expect(await cache.getResult("k2")).toEqual({
    kind: "incomplete",
    lineIndexes: [1],
  });
  expect(await cache.getResult("k3")).toBeUndefined();
});
it("limits how many results are kept", async () => {
  let clock = 0;
  const cache = fresh({ maxResults: 2, now: () => ++clock });
  await cache.putResult("old", complete);
  await cache.putResult("mid", complete);
  await cache.putResult("new", complete);
  expect(await cache.getResult("old")).toBeUndefined();
  expect(await cache.getResult("mid")).toBeDefined();
  expect(await cache.getResult("new")).toBeDefined();
});
it("clears audio and results together", async () => {
  const cache = fresh();
  await cache.putAudio("abcdefghijk", 10, pcm(4));
  await cache.putResult("k", complete);
  await cache.clear();
  expect(await cache.getAudio("abcdefghijk", 10)).toBeUndefined();
  expect(await cache.getResult("k")).toBeUndefined();
});
it("keys results by video, duration, lyrics, language and ignores raw formatting", async () => {
  const base = {
    videoId: "abcdefghijk",
    durationMs: 213060,
    lyrics,
    language: "en",
  };
  const key = await resultCacheKey(base);
  expect(await resultCacheKey({ ...base })).toBe(key);
  expect(
    await resultCacheKey({ ...base, lyrics: { ...lyrics, rawText: "A\n\nB" } }),
  ).toBe(key);
  expect(await resultCacheKey({ ...base, videoId: "zzzzzzzzzzz" })).not.toBe(
    key,
  );
  expect(await resultCacheKey({ ...base, durationMs: 214000 })).not.toBe(key);
  expect(await resultCacheKey({ ...base, language: undefined })).not.toBe(key);
  expect(
    await resultCacheKey({
      ...base,
      lyrics: { ...lyrics, lyrics: ["a", "c"] },
    }),
  ).not.toBe(key);
});
