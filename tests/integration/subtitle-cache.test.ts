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
  await cache.putResult("k1", "abcdefghijk", complete);
  await cache.putResult("k2", "abcdefghijk", {
    kind: "incomplete",
    lineIndexes: [1],
  });
  await cache.putResult("k3", "abcdefghijk", { kind: "invalid", code: "X" });
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
  await cache.putResult("old", "abcdefghijk", complete);
  await cache.putResult("mid", "abcdefghijk", complete);
  await cache.putResult("new", "abcdefghijk", complete);
  expect(await cache.getResult("old")).toBeUndefined();
  expect(await cache.getResult("mid")).toBeDefined();
  expect(await cache.getResult("new")).toBeDefined();
});
it("clears audio and results together", async () => {
  const cache = fresh();
  await cache.putAudio("abcdefghijk", 10, pcm(4));
  await cache.putResult("k", "abcdefghijk", complete);
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

const info = { title: "Song", channel: "Artist", durationMs: 213060 };
it("lists one entry per video with size, result count and video info", async () => {
  let clock = 0;
  const cache = fresh({ now: () => ++clock });
  await cache.putAudio("aaaaaaaaaaa", 10, pcm(10)); // 20 bytes
  await cache.putResult("r1", "aaaaaaaaaaa", complete);
  await cache.putResult("r2", "aaaaaaaaaaa", complete);
  await cache.describe("aaaaaaaaaaa", info);
  await cache.putResult("r3", "bbbbbbbbbbb", complete); // result only, no audio
  const entries = await cache.list();
  expect(entries.map((e) => e.videoId)).toEqual(["bbbbbbbbbbb", "aaaaaaaaaaa"]);
  expect(entries[1]).toMatchObject({
    videoId: "aaaaaaaaaaa",
    title: "Song",
    channel: "Artist",
    durationMs: 213060,
    audioBytes: 20,
    resultCount: 2,
  });
  expect(entries[0]).toMatchObject({
    title: "",
    audioBytes: 0,
    resultCount: 1,
  });
});
it("ignores video info that has no cached data", async () => {
  const cache = fresh();
  await cache.describe("aaaaaaaaaaa", info);
  expect(await cache.list()).toEqual([]);
});
it("deletes one video's audio, results and info without touching others", async () => {
  const cache = fresh();
  for (const id of ["aaaaaaaaaaa", "bbbbbbbbbbb"]) {
    await cache.putAudio(id, 10, pcm(4));
    await cache.putResult("r-" + id, id, complete);
    await cache.describe(id, info);
  }
  await cache.deleteVideo("aaaaaaaaaaa");
  expect((await cache.list()).map((e) => e.videoId)).toEqual(["bbbbbbbbbbb"]);
  expect(await cache.getAudio("aaaaaaaaaaa", 10)).toBeUndefined();
  expect(await cache.getResult("r-aaaaaaaaaaa")).toBeUndefined();
  expect(await cache.getResult("r-bbbbbbbbbbb")).toBeDefined();
});
it("drops v1 results (no video id) when upgrading but keeps audio", async () => {
  const name = "cache-upgrade-" + n++;
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => {
      for (const store of ["audio", "audioMeta", "results"])
        open.result.createObjectStore(store);
    };
    open.onsuccess = () => {
      const tx = open.result.transaction(
        ["audio", "audioMeta", "results"],
        "readwrite",
      );
      tx.objectStore("audio").put(
        { durationMs: 10000, pcm: pcm(4) },
        "aaaaaaaaaaa",
      );
      tx.objectStore("audioMeta").put({ bytes: 8, lastUsed: 1 }, "aaaaaaaaaaa");
      tx.objectStore("results").put({ result: complete, lastUsed: 1 }, "old");
      tx.oncomplete = () => {
        open.result.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
  const cache = createSubtitleCache({ dbName: name });
  expect(await cache.getResult("old")).toBeUndefined();
  expect(await cache.getAudio("aaaaaaaaaaa", 10)).toBeDefined();
});
