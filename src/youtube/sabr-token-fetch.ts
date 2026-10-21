import { replaceSabrPoToken } from "./sabr-protocol";

function waitForToken(
  getToken: () => Promise<Uint8Array>,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (signal.aborted)
    return Promise.reject(new DOMException("已取消", "AbortError"));
  return new Promise((resolve, reject) => {
    const cancel = () => {
      signal.removeEventListener("abort", cancel);
      reject(new DOMException("已取消", "AbortError"));
    };
    signal.addEventListener("abort", cancel, { once: true });
    // Cancelling one media request must not cancel the shared Token operation.
    Promise.resolve()
      .then(() => {
        if (signal.aborted) throw new DOMException("已取消", "AbortError");
        return getToken();
      })
      .then(
        (token) => {
          signal.removeEventListener("abort", cancel);
          resolve(token);
        },
        (error) => {
          signal.removeEventListener("abort", cancel);
          reject(error);
        },
      );
  });
}
export function isSabrUrl(value: string) {
  try {
    const url = new URL(
      value,
      typeof location === "undefined" ? undefined : location.href,
    );
    return (
      url.protocol === "https:" &&
      url.hostname.endsWith(".googlevideo.com") &&
      url.pathname === "/videoplayback"
    );
  } catch {
    return false;
  }
}
export function createSabrFetch(
  native: typeof fetch,
  getToken: () => Promise<Uint8Array>,
): typeof fetch {
  return async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method =
      init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method.toUpperCase() !== "POST" || !isSabrUrl(url))
      return native(input, init);
    const request = new Request(input, init);
    if (request.signal.aborted) throw new DOMException("已取消", "AbortError");
    const body = new Uint8Array(await request.clone().arrayBuffer());
    if (!replaceSabrPoToken(body, new Uint8Array([0]))) return native(request);
    const token = await waitForToken(getToken, request.signal);
    if (request.signal.aborted) throw new DOMException("已取消", "AbortError");
    const replaced = replaceSabrPoToken(body, token);
    if (!replaced) throw Error("SABR Token 替換失敗");
    return native(new Request(request, { body: replaced.slice().buffer }));
  };
}
