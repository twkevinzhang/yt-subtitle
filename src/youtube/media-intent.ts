/** MAIN world at document_start, before YouTube registers its Media Session actions. */
export function installMediaIntentBridge() {
  const session = navigator.mediaSession;
  if (!session) return () => {};
  const original = session.setActionHandler;
  let pauseObserved = false,
    lastNonce: string | undefined;
  const notify = () => {
    if (lastNonce)
      window.postMessage(
        {
          tag: "ai-lyrics-media-ready",
          nonce: lastNonce,
          available: session.setActionHandler === wrapped && pauseObserved,
        },
        location.origin,
      );
  };
  const wrapped: typeof original = function (action, handler) {
    const result = original.call(
      session,
      action,
      handler && (action === "pause" || action === "stop")
        ? function (details) {
            window.postMessage(
              {
                tag: "ai-lyrics-media-intent",
                videoId: new URL(location.href).searchParams.get("v"),
                action: "pause",
              },
              location.origin,
            );
            return handler(details);
          }
        : handler,
    );
    if (action === "pause") {
      pauseObserved = !!handler;
      notify();
    }
    return result;
  };
  try {
    session.setActionHandler = wrapped;
  } catch {
    return () => {};
  }
  const query = (event: MessageEvent) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.tag !== "ai-lyrics-media-query" ||
      typeof event.data.nonce !== "string"
    )
      return;
    lastNonce = event.data.nonce;
    notify();
  };
  window.addEventListener("message", query);
  return () => {
    window.removeEventListener("message", query);
    if (session.setActionHandler === wrapped)
      session.setActionHandler = original;
  };
}
