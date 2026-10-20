import { z } from "zod";
import { lineSchema, subtitleSourceSchema } from "../shared/schemas";
import { lockTiming } from "../lyrics/timing-locks";
import { validateTiming } from "../lyrics/formats";
import type { ResultKey, SavedResult } from "../shared/types";
export const resultKeySchema = z
  .object({
    videoId: z.string().regex(/^[\w-]{11}$/),
    inputHash: z.string().min(1),
    targetLanguage: z.enum(["ja", "zh-Hant", "en"]),
    schemaVersion: z.literal(1),
  })
  .strict();
export const resultSchema = z
  .object({
    schemaVersion: z.literal(1),
    key: resultKeySchema,
    subtitleSource: subtitleSourceSchema.optional(),
    videoDurationMs: z.number().finite().positive(),
    source: z
      .object({
        kind: z.enum(["network", "user"]),
        url: z.string().url().optional(),
        version: z.string().optional(),
      })
      .strict(),
    lines: z.array(lineSchema).max(10000),
    offsetMs: z.number().finite(),
    model: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("ai-lyrics", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("results");
    r.onerror = () => reject(new Error("本機資料庫無法開啟"));
    r.onsuccess = () => resolve(r.result);
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  work: (
    store: IDBObjectStore,
    resolve: (v: T) => void,
    reject: (e: Error) => void,
  ) => void,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction("results", mode);
    let value: T;
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(new Error("本機儲存失敗，請清除部分結果後重試"));
    };
    work(
      tx.objectStore("results"),
      (v) => {
        value = v;
      },
      (e) => {
        tx.abort();
        reject(e);
      },
    );
  });
}
const keyOf = (key: ResultKey) =>
  JSON.stringify([
    key.videoId,
    key.inputHash,
    key.targetLanguage,
    key.schemaVersion,
  ]);
export async function saveResult(value: SavedResult) {
  const result = resultSchema.parse(value);
  if (
    validateTiming(result.lines, result.videoDurationMs, result.offsetMs).some(
      (i) => i.severity === "error",
    )
  )
    throw new Error("請先校正時間或排除未對齊句子");
  await transaction<void>("readwrite", (store, resolve, reject) => {
    const all = store.getAll();
    all.onsuccess = () => {
      const records = (all.result as SavedResult[]).filter(
        (r) => keyOf(r.key) !== keyOf(result.key),
      );
      const bytes = new TextEncoder().encode(
        JSON.stringify([...records, result]),
      ).length;
      if (bytes > 104857600) {
        reject(new Error("結果超過 100 MiB，請先匯出或刪除部分資料"));
        return;
      }
      store.put(result, keyOf(result.key));
      resolve();
    };
  });
}
export async function listResults(videoId?: string) {
  return transaction<SavedResult[]>("readonly", (store, resolve) => {
    const r = store.getAll();
    r.onsuccess = () =>
      resolve(
        (r.result as SavedResult[])
          .filter((x) => !videoId || x.key.videoId === videoId)
          .map((x) => ({
            ...x,
            subtitleSource: x.subtitleSource ?? { kind: "legacy" as const },
            lines: x.lines.map((line) => lockTiming(line, x.videoDurationMs)),
          }))
          .sort((a, b) => b.updatedAt - a.updatedAt),
      );
  });
}
export async function deleteResult(value: ResultKey) {
  const key = resultKeySchema.parse(value);
  return transaction<void>("readwrite", (s, r) => {
    s.delete(keyOf(key));
    r();
  });
}
export async function clearResults() {
  return transaction<void>("readwrite", (s, r) => {
    s.clear();
    r();
  });
}
export async function hashInput(value: unknown) {
  const canonical = JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
  const data = new TextEncoder().encode(canonical);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
