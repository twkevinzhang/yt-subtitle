// Isolated-world relay: background asks, the MAIN-world tap answers.
import { TAP_SOURCE, type TapResponse } from "./audio-tap";

export interface AudioTapRequest {
  type: "audio-tap-request";
  videoId: string;
  durationSeconds: number;
}
const REPLY_TIMEOUT_MS = 30_000;

function askPage(videoId: string, durationSeconds: number) {
  return new Promise<TapResponse>((resolve, reject) => {
    const id = crypto.randomUUID();
    const finish = (run: () => void) => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      run();
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        | {
            source?: string;
            kind?: string;
            id?: string;
            response?: TapResponse;
          }
        | undefined;
      if (
        event.source === window &&
        data?.source === TAP_SOURCE &&
        data.kind === "reply" &&
        data.id === id &&
        data.response
      )
        finish(() => resolve(data.response!));
    };
    const timer = setTimeout(
      () => finish(() => reject(Error("頁面音訊擷取器沒有回應"))),
      REPLY_TIMEOUT_MS,
    );
    window.addEventListener("message", onMessage);
    window.postMessage(
      { source: TAP_SOURCE, kind: "request", id, videoId, durationSeconds },
      location.origin,
    );
  });
}

export function installAudioTapBridge() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    const request = message as Partial<AudioTapRequest> | undefined;
    if (
      request?.type !== "audio-tap-request" ||
      typeof request.videoId !== "string" ||
      typeof request.durationSeconds !== "number"
    )
      return false;
    askPage(request.videoId, request.durationSeconds).then(
      (response) => sendResponse({ ok: true, response }),
      (error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
    return true;
  });
}
