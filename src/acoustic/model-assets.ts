import manifest from "./model-manifest.json";
import { MODEL_ID, MODEL_REVISION, MAX_AUDIO_BYTES } from "./contracts";
const CACHE = "ai-lyrics-model-" + MODEL_REVISION;
const base = `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/`;
export async function sha256(bytes: ArrayBuffer) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function fetchModelAsset(
  file: string,
  fetcher: typeof fetch = fetch,
): Promise<ArrayBuffer> {
  if (!manifest.files.includes(file)) throw new Error("模型檔不在固定清單中");
  const localUrl =
    import.meta.url.replace(/acoustic\/[^/]+$/, "") +
    `models/${MODEL_ID}/${file}`;
  let response: Response | undefined;
  try {
    response = await fetcher(localUrl, { credentials: "omit" });
  } catch {
    /* file is not bundled */
  }
  if (!response?.ok)
    response = await fetcher(base + file, {
      credentials: "omit",
      signal: AbortSignal.timeout(60000),
    });
  return boundedBody(response);
}
async function boundedBody(response: Response) {
  if (!response.ok) throw new Error(`模型下載失敗：HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("模型下載沒有內容");
  let length = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_AUDIO_BYTES) throw new Error("單一模型檔超過大小上限");
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(length);
  let cursor = 0;
  for (const part of parts) {
    bytes.set(part, cursor);
    cursor += part.byteLength;
  }
  return bytes.buffer;
}
export async function prepareModelAssets(progress: (file: string) => void) {
  const cache = await caches.open(CACHE);
  for (const file of manifest.files) {
    progress(file);
    const url = base + file,
      expected = manifest.sha256[file as keyof typeof manifest.sha256];
    const cached = await cache.match(url);
    if (cached && (await sha256(await cached.arrayBuffer())) === expected)
      continue;
    await cache.delete(url);
    // A local package copy is useful for offline distributions and fixture tests.
    const bytes = await fetchModelAsset(file);
    if ((await sha256(bytes)) !== expected)
      throw new Error(`模型完整性檢查失敗：${file}`);
    await cache.put(url, new Response(bytes));
  }
  return {
    async match(request: Request | string) {
      const name = typeof request === "string" ? request : request.url;
      const file = manifest.files.find(
        (f) => name === base + f || name === `/models/${MODEL_ID}/${f}`,
      );
      return file ? await cache.match(base + file) : undefined;
    },
    async put() {
      throw new Error("模型只允許經過完整性檢查後寫入");
    },
  };
}
