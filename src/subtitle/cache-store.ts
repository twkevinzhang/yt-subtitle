import type { PreparedLyrics, ResultValidation } from "./types";
import { LIBRARY_VERSION } from "./library-version";

const DURATION_TOLERANCE_MS = 1000;
export interface CacheOptions {
  dbName?: string;
  /** Least-recently-used audio is evicted beyond this many bytes of PCM. */
  maxAudioBytes?: number;
  maxResults?: number;
  now?: () => number;
}
interface AudioRecord {
  durationMs: number;
  pcm: Int16Array;
}
interface AudioMeta {
  bytes: number;
  lastUsed: number;
}
interface ResultRecord {
  result: ResultValidation;
  lastUsed: number;
}
export interface ResultKeyInput {
  videoId: string;
  durationMs: number;
  lyrics: PreparedLyrics;
  language?: string;
}
export interface SubtitleCache {
  getAudio(
    videoId: string,
    durationSeconds: number,
  ): Promise<Int16Array | undefined>;
  putAudio(
    videoId: string,
    durationSeconds: number,
    pcm: Int16Array,
  ): Promise<void>;
  getResult(key: string): Promise<ResultValidation | undefined>;
  putResult(key: string, result: ResultValidation): Promise<void>;
  clear(): Promise<void>;
}

export async function resultCacheKey(input: ResultKeyInput) {
  const canonical = JSON.stringify({
    // v2: lines are aligned directly with createAligner; v1 results came from
    // transcribe-then-match and must not be served for the same inputs.
    v: 2,
    library: LIBRARY_VERSION,
    videoId: input.videoId,
    durationMs: Math.round(input.durationMs),
    lines: input.lyrics.lyrics,
    sourceLineIndexes: input.lyrics.sourceLineIndexes,
    language: input.language ?? null,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}

export function createSubtitleCache(options: CacheOptions = {}): SubtitleCache {
  const dbName = options.dbName ?? "subtitle-cache-v1";
  const maxAudioBytes = options.maxAudioBytes ?? 300 * 1024 * 1024;
  const maxResults = options.maxResults ?? 500;
  const now = options.now ?? (() => Date.now());

  function database() {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        for (const name of ["audio", "audioMeta", "results"])
          request.result.createObjectStore(name);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function run<T>(
    stores: string[],
    mode: IDBTransactionMode,
    work: (
      stores: Record<string, IDBObjectStore>,
      done: (value: T) => void,
    ) => void,
  ) {
    const db = await database();
    try {
      return await new Promise<T>((resolve, reject) => {
        let value: T;
        const tx = db.transaction(stores, mode);
        tx.oncomplete = () => resolve(value);
        tx.onabort = () => reject(tx.error ?? Error("快取寫入失敗"));
        tx.onerror = () => reject(tx.error);
        work(
          Object.fromEntries(
            stores.map((name) => [name, tx.objectStore(name)]),
          ),
          (v) => {
            value = v;
          },
        );
      });
    } finally {
      db.close();
    }
  }
  const request = <T>(r: IDBRequest<T>, then: (value: T) => void) => {
    r.onsuccess = () => then(r.result);
  };

  return {
    getAudio(videoId, durationSeconds) {
      return run<Int16Array | undefined>(
        ["audio", "audioMeta"],
        "readwrite",
        (s, done) =>
          request(s.audio!.get(videoId), (record: AudioRecord | undefined) => {
            const stored = record?.pcm;
            if (
              !record ||
              !ArrayBuffer.isView(stored) ||
              stored.BYTES_PER_ELEMENT !== 2 ||
              !stored.byteLength ||
              Math.abs(record.durationMs - durationSeconds * 1000) >
                DURATION_TOLERANCE_MS
            )
              return;
            s.audioMeta!.put(
              {
                bytes: stored.byteLength,
                lastUsed: now(),
              } satisfies AudioMeta,
              videoId,
            );
            done(
              new Int16Array(
                stored.buffer,
                stored.byteOffset,
                stored.byteLength / 2,
              ),
            );
          }),
      );
    },
    async putAudio(videoId, durationSeconds, pcm) {
      if (!pcm.length || pcm.byteLength > maxAudioBytes) return;
      await run<void>(["audio", "audioMeta"], "readwrite", (s, done) => {
        s.audio!.put(
          {
            durationMs: Math.round(durationSeconds * 1000),
            pcm,
          } satisfies AudioRecord,
          videoId,
        );
        s.audioMeta!.put(
          { bytes: pcm.byteLength, lastUsed: now() } satisfies AudioMeta,
          videoId,
        );
        const keys = s.audioMeta!.getAllKeys();
        const metas = s.audioMeta!.getAll();
        metas.onsuccess = () => {
          const entries = (keys.result as string[])
            .map((key, i) => ({ key, ...(metas.result[i] as AudioMeta) }))
            .sort((a, b) => a.lastUsed - b.lastUsed);
          let total = entries.reduce((n, e) => n + e.bytes, 0);
          for (const entry of entries) {
            if (total <= maxAudioBytes) break;
            if (entry.key === videoId) continue;
            s.audio!.delete(entry.key);
            s.audioMeta!.delete(entry.key);
            total -= entry.bytes;
          }
          done();
        };
      });
    },
    getResult(key) {
      return run<ResultValidation | undefined>(
        ["results"],
        "readwrite",
        (s, done) =>
          request(s.results!.get(key), (record: ResultRecord | undefined) => {
            if (!record) return;
            s.results!.put({ ...record, lastUsed: now() }, key);
            done(record.result);
          }),
      );
    },
    async putResult(key, result) {
      if (result.kind === "invalid") return;
      await run<void>(["results"], "readwrite", (s, done) => {
        s.results!.put({ result, lastUsed: now() } satisfies ResultRecord, key);
        const keys = s.results!.getAllKeys();
        const records = s.results!.getAll();
        records.onsuccess = () => {
          const entries = (keys.result as string[])
            .map((k, i) => ({
              k,
              lastUsed: (records.result[i] as ResultRecord).lastUsed,
            }))
            .sort((a, b) => a.lastUsed - b.lastUsed);
          for (const entry of entries.slice(
            0,
            Math.max(0, entries.length - maxResults),
          ))
            if (entry.k !== key) s.results!.delete(entry.k);
          done();
        };
      });
    },
    clear() {
      return run<void>(
        ["audio", "audioMeta", "results"],
        "readwrite",
        (s, done) => {
          for (const store of Object.values(s)) store.clear();
          done();
        },
      );
    },
  };
}
export const subtitleCache = createSubtitleCache();
