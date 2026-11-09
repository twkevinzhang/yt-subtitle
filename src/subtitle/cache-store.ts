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
  videoId: string;
  result: ResultValidation;
  lastUsed: number;
}
export interface VideoInfo {
  title: string;
  channel: string;
  durationMs: number;
}
export interface CacheEntry {
  videoId: string;
  title: string;
  channel: string;
  durationMs: number;
  audioBytes: number;
  resultCount: number;
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
  putResult(
    key: string,
    videoId: string,
    result: ResultValidation,
  ): Promise<void>;
  describe(videoId: string, info: VideoInfo): Promise<void>;
  list(): Promise<CacheEntry[]>;
  deleteVideo(videoId: string): Promise<void>;
  clear(): Promise<void>;
}

export async function resultCacheKey(input: ResultKeyInput) {
  const canonical = JSON.stringify({
    v: 1,
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

const STORES = ["audio", "audioMeta", "results", "videos"];
export function createSubtitleCache(options: CacheOptions = {}): SubtitleCache {
  const dbName = options.dbName ?? "subtitle-cache-v1";
  const maxAudioBytes = options.maxAudioBytes ?? 300 * 1024 * 1024;
  const maxResults = options.maxResults ?? 500;
  const now = options.now ?? (() => Date.now());

  function database() {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 2);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        for (const name of STORES)
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        // v1 results were not tied to a video, so they cannot be listed or removed.
        if (event.oldVersion === 1)
          request.transaction!.objectStore("results").clear();
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
    async putResult(key, videoId, result) {
      if (result.kind === "invalid") return;
      await run<void>(["results"], "readwrite", (s, done) => {
        s.results!.put(
          { videoId, result, lastUsed: now() } satisfies ResultRecord,
          key,
        );
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
    async describe(videoId, info) {
      await run<void>(["videos"], "readwrite", (s, done) => {
        s.videos!.put(info, videoId);
        done();
      });
    },
    list() {
      return run<CacheEntry[]>(STORES, "readonly", (s, done) => {
        const audioKeys = s.audioMeta!.getAllKeys();
        const audioMetas = s.audioMeta!.getAll();
        const resultRecords = s.results!.getAll();
        const videoKeys = s.videos!.getAllKeys();
        const videoInfos = s.videos!.getAll();
        const requests = [
          audioKeys,
          audioMetas,
          resultRecords,
          videoKeys,
          videoInfos,
        ];
        let pending = requests.length;
        const finish = () => {
          if (--pending) return;
          const entries = new Map<string, CacheEntry>();
          const entry = (videoId: string) => {
            let e = entries.get(videoId);
            if (!e) {
              e = {
                videoId,
                title: "",
                channel: "",
                durationMs: 0,
                audioBytes: 0,
                resultCount: 0,
                lastUsed: 0,
              };
              entries.set(videoId, e);
            }
            return e;
          };
          (audioKeys.result as string[]).forEach((videoId, i) => {
            const meta = audioMetas.result[i] as AudioMeta;
            const e = entry(videoId);
            e.audioBytes = meta.bytes;
            e.lastUsed = Math.max(e.lastUsed, meta.lastUsed);
          });
          for (const record of resultRecords.result as ResultRecord[]) {
            if (!record.videoId) continue;
            const e = entry(record.videoId);
            e.resultCount++;
            e.lastUsed = Math.max(e.lastUsed, record.lastUsed);
          }
          (videoKeys.result as string[]).forEach((videoId, i) => {
            const e = entries.get(videoId);
            if (!e) return;
            const info = videoInfos.result[i] as VideoInfo;
            e.title = info.title;
            e.channel = info.channel;
            e.durationMs = info.durationMs;
          });
          done([...entries.values()].sort((a, b) => b.lastUsed - a.lastUsed));
        };
        for (const r of requests) r.onsuccess = finish;
      });
    },
    deleteVideo(videoId) {
      return run<void>(STORES, "readwrite", (s, done) => {
        s.audio!.delete(videoId);
        s.audioMeta!.delete(videoId);
        s.videos!.delete(videoId);
        const keys = s.results!.getAllKeys();
        const records = s.results!.getAll();
        records.onsuccess = () => {
          (keys.result as string[]).forEach((key, i) => {
            if ((records.result[i] as ResultRecord).videoId === videoId)
              s.results!.delete(key);
          });
          done();
        };
      });
    },
    clear() {
      return run<void>(STORES, "readwrite", (s, done) => {
        for (const store of Object.values(s)) store.clear();
        done();
      });
    },
  };
}
export const subtitleCache = createSubtitleCache();
