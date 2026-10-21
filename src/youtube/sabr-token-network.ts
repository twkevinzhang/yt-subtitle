import { createSabrFetch, isSabrUrl } from "./sabr-token-fetch";
import { replaceSabrPoToken } from "./sabr-protocol";
/** Installed only inside this extension's nonce-bound helper frame. */
export function installSabrTokenNetwork(
  getToken: () => Promise<Uint8Array>,
  onError: (message: string) => void,
) {
  let disposed = false;
  const fetchOriginal = window.fetch;
  const fetchWrapped = createSabrFetch(fetchOriginal.bind(window), async () => {
    try {
      const token = await getToken();
      if (disposed) throw new DOMException("已取消", "AbortError");
      return token;
    } catch (e) {
      if (!disposed && !(e instanceof DOMException && e.name === "AbortError"))
        onError("無法取得串流驗證 Token，請稍後重試");
      throw e;
    }
  });
  const fetchHandler = fetchWrapped;
  window.fetch = fetchHandler;
  const open = XMLHttpRequest.prototype.open,
    send = XMLHttpRequest.prototype.send,
    abort = XMLHttpRequest.prototype.abort;
  const state = new WeakMap<
    XMLHttpRequest,
    { sabr: boolean; cancelled: boolean; sent: boolean; epoch: number }
  >();
  const openHandler = function (
    this: XMLHttpRequest,
    ...args: Parameters<typeof open>
  ) {
    state.set(this, {
      sabr:
        args[0].toUpperCase() === "POST" &&
        args[2] !== false &&
        isSabrUrl(String(args[1])),
      cancelled: false,
      sent: false,
      epoch: (state.get(this)?.epoch ?? 0) + 1,
    });
    return open.apply(this, args);
  } as typeof open;
  const sendHandler = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const own = state.get(this);
    if (own?.sent)
      throw new DOMException("XHR 請求已送出", "InvalidStateError");
    const bytes =
      body instanceof ArrayBuffer
        ? new Uint8Array(body)
        : ArrayBuffer.isView(body)
          ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
          : undefined;
    if (!own?.sabr || !bytes || !replaceSabrPoToken(bytes, new Uint8Array([0])))
      return send.call(this, body);
    // Native send() snapshots BufferSource synchronously and rejects a second
    // send before a new open(), even while our authorization is still pending.
    const snapshot = bytes.slice();
    own.sent = true;
    void getToken()
      .then((token) => {
        if (disposed || own.cancelled || state.get(this) !== own) return;
        const replaced = replaceSabrPoToken(snapshot, token);
        if (!replaced) throw Error("invalid SABR");
        send.call(this, replaced.slice().buffer);
      })
      .catch(() => {
        if (!disposed && !own.cancelled && state.get(this) === own) {
          onError("無法取得串流驗證 Token，請稍後重試");
          abort.call(this);
        }
      });
  };
  const abortHandler = function (this: XMLHttpRequest) {
    const own = state.get(this);
    if (own) own.cancelled = true;
    return abort.call(this);
  };
  XMLHttpRequest.prototype.open = openHandler;
  XMLHttpRequest.prototype.send = sendHandler;
  XMLHttpRequest.prototype.abort = abortHandler;
  return () => {
    disposed = true;
    if (window.fetch === fetchHandler) window.fetch = fetchOriginal;
    if (XMLHttpRequest.prototype.open === openHandler)
      XMLHttpRequest.prototype.open = open;
    if (XMLHttpRequest.prototype.send === sendHandler)
      XMLHttpRequest.prototype.send = send;
    if (XMLHttpRequest.prototype.abort === abortHandler)
      XMLHttpRequest.prototype.abort = abort;
  };
}
