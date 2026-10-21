import {
  PO_TOKEN_SERVICE_URL,
  poTokenResponseSchema,
  type PoTokenResponse,
} from "../shared/po-token";
export function createPoTokenClient(
  options: {
    fetcher?: typeof fetch;
    endpoint?: string;
  } = {},
) {
  const endpoint = new URL(options.endpoint ?? PO_TOKEN_SERVICE_URL);
  if (
    endpoint.protocol !== "https:" ||
    !endpoint.hostname.endsWith(".run.app") ||
    endpoint.pathname !== "/" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw Error("Token 服務網址無效");
  const fetcher = options.fetcher ?? fetch;
  const cache = new Map<string, PoTokenResponse>();
  return {
    clear() {
      cache.clear();
    },
    async get(videoId: string, signal: AbortSignal): Promise<PoTokenResponse> {
      if (signal.aborted) throw new DOMException("已取消", "AbortError");
      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw Error("影片 ID 無效");
      const existing = cache.get(videoId);
      if (existing && Date.parse(existing.expiresAt) > Date.now() + 30_000)
        return existing;
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal.addEventListener("abort", cancel, { once: true });
      const timeout = setTimeout(cancel, 28_000);
      try {
        const response = await fetcher(new URL("/v1/po-token", endpoint), {
          method: "POST",
          body: JSON.stringify({ videoId }),
          headers: { "content-type": "application/json" },
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok)
          throw Error(
            response.status === 429
              ? "Token 服務忙碌或產生額度已用完，請稍後再試"
              : `Token 服務暫時無法使用（${response.status}）`,
          );
        if (Number(response.headers.get("content-length") ?? 0) > 8192)
          throw Error("Token 回覆過大");
        const reader = response.body?.getReader();
        const parts: Uint8Array[] = [];
        let size = 0;
        if (reader)
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 8192) {
              await reader.cancel();
              throw Error("Token 回覆過大");
            }
            parts.push(value);
          }
        const bytes = new Uint8Array(size);
        let at = 0;
        for (const part of parts) {
          bytes.set(part, at);
          at += part.length;
        }
        const result = poTokenResponseSchema.parse(
          JSON.parse(new TextDecoder().decode(bytes)),
        );
        if (signal.aborted || controller.signal.aborted)
          throw new DOMException("已取消", "AbortError");
        if (
          result.videoId !== videoId ||
          Date.parse(result.expiresAt) <= Date.now() ||
          Date.parse(result.expiresAt) > Date.now() + 24 * 3600_000
        )
          throw Error("Token 影片或期限不符");
        if (cache.size >= 20) cache.delete(cache.keys().next().value!);
        cache.set(videoId, result);
        return result;
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", cancel);
      }
    },
  };
}
