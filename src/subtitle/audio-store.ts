import type { AudioInput } from "./library-contract";
import type { AudioHandle } from "./audio-provider";
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("subtitle-audio-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("audio");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("audio", mode),
        request = operation(tx.objectStore("audio"));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? Error("音訊暫存失敗"));
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function stageAudio(audio: AudioInput): Promise<AudioHandle> {
  if (
    audio.sampleRate !== 16000 ||
    !audio.pcm.length ||
    audio.pcm.some((x) => !Number.isFinite(x))
  )
    throw Error("無效的 PCM");
  const id = crypto.randomUUID();
  await transaction("readwrite", (store) => store.put(audio, id));
  return { id, sampleRate: 16000, sampleCount: audio.pcm.length };
}
export async function readAudio(handle: AudioHandle): Promise<AudioInput> {
  const audio = await transaction<AudioInput | undefined>("readonly", (store) =>
    store.get(handle.id),
  );
  if (
    !audio ||
    audio.sampleRate !== handle.sampleRate ||
    audio.pcm.length !== handle.sampleCount
  )
    throw Object.assign(Error("音訊暫存不存在或不完整"), {
      code: "AUDIO_UNAVAILABLE",
    });
  return audio;
}
export async function releaseAudio(id: string) {
  await transaction("readwrite", (store) => store.delete(id));
}
export async function clearAudio() {
  await transaction("readwrite", (store) => store.clear());
}
