import { assertAudioSize } from "./audio-source";
const NAME = "ai-lyrics-job-audio";
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("audio");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function transact<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("audio", mode),
        r = work(tx.objectStore("audio"));
      let value: T;
      r.onsuccess = () => {
        value = r.result;
      };
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
// Preparation handshake must precede staging: cold hosts clear orphan inputs.
export async function stageJobAudio(
  assetId: string,
  data: ArrayBuffer,
  prepareHost: () => Promise<void>,
) {
  assertAudioSize(data.byteLength);
  await prepareHost();
  await transact("readwrite", (s) => s.put(data, assetId));
}
export async function takeJobAudio(assetId: string): Promise<ArrayBuffer> {
  let data = await transact("readonly", (s) => s.get(assetId));
  await transact("readwrite", (s) => s.delete(assetId));
  if (!(data instanceof ArrayBuffer)) {
    // IndexedDB implementations may clone into another JS realm. Use the
    // native ArrayBuffer brand check rather than accepting a spoofed tag.
    try {
      data = ArrayBuffer.prototype.slice.call(data, 0);
    } catch {
      throw new Error("音訊輸入不存在或已清除");
    }
  }
  assertAudioSize(data.byteLength);
  return data;
}
export async function clearJobAudio() {
  await transact("readwrite", (s) => s.clear());
}
export async function deleteJobAudio(assetId: string) {
  await transact("readwrite", (s) => s.delete(assetId));
}
