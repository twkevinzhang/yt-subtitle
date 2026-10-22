import type { AudioHandle } from "./audio-provider";
import type { Progress } from "./library-contract";
import type { PreparedLyrics, ResultValidation } from "./types";
import { releaseAudio, clearAudio } from "./audio-store";
/** Background restart interrupts old work; close its host before removing orphan PCM. */
export async function initializeHost() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL("subtitle-host.html")],
  });
  if (contexts.length) await chrome.offscreen.closeDocument();
  await clearAudio();
}
let creating: Promise<void> | undefined;
async function ensureHost() {
  const url = chrome.runtime.getURL("subtitle-host.html");
  if (
    (
      await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
        documentUrls: [url],
      })
    ).length
  )
    return;
  creating ??= chrome.offscreen
    .createDocument({
      url: "subtitle-host.html",
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "在專用 Worker 執行本機歌詞對齊，不影響影片播放",
    })
    .finally(() => {
      creating = undefined;
    });
  await creating;
}
let queue: Promise<unknown> = Promise.resolve();
export function runInHost(
  audio: AudioHandle,
  lyrics: PreparedLyrics,
  language: string | undefined,
  signal: AbortSignal,
  onProgress: (progress: Progress) => void,
): Promise<ResultValidation> {
  return new Promise((resolve, reject) => {
    let started = false,
      cancelled = false;
    const abortWaiting = () => {
      if (started || cancelled) return;
      cancelled = true;
      signal.removeEventListener("abort", abortWaiting);
      void releaseAudio(audio.id)
        .catch(() => {})
        .then(() =>
          reject(Object.assign(Error("排隊工作已取消"), { code: "ABORTED" })),
        );
    };
    signal.addEventListener("abort", abortWaiting, { once: true });
    if (signal.aborted) abortWaiting();
    queue = queue
      .catch(() => {})
      .then(async () => {
        signal.removeEventListener("abort", abortWaiting);
        if (cancelled) return;
        started = true;
        try {
          resolve(await execute(audio, lyrics, language, signal, onProgress));
        } catch (error) {
          reject(error);
        }
      });
  });
}
async function execute(
  audio: AudioHandle,
  lyrics: PreparedLyrics,
  language: string | undefined,
  signal: AbortSignal,
  onProgress: (progress: Progress) => void,
): Promise<ResultValidation> {
  try {
    signal.throwIfAborted();
    await ensureHost();
    signal.throwIfAborted();
    return await new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: "lyric-align-host-v1" });
      let settled = false;
      let cancelTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: unknown, result?: ResultValidation) => {
        if (settled) return;
        settled = true;
        clearTimeout(cancelTimer);
        signal.removeEventListener("abort", abort);
        port.disconnect();
        error ? reject(error) : resolve(result!);
      };
      const abort = () => {
        port.postMessage({ type: "cancel" });
        // A stuck Worker cannot hold the queue forever; finally closes the entire host.
        cancelTimer = setTimeout(
          () => finish(Object.assign(Error("工作已取消"), { code: "ABORTED" })),
          5000,
        );
      };
      signal.addEventListener("abort", abort, { once: true });
      port.onDisconnect.addListener(() =>
        finish(
          Object.assign(Error("字幕處理程序已中斷"), { code: "INTERRUPTED" }),
        ),
      );
      port.onMessage.addListener((message) => {
        if (message.type === "progress") onProgress(message.progress);
        else if (message.type === "result") finish(undefined, message.result);
        else if (message.type === "error") finish(message.error);
      });
      port.postMessage({ type: "run", audio, lyrics, language });
    });
  } finally {
    await chrome.offscreen.closeDocument().catch(() => {});
    await releaseAudio(audio.id).catch(() => {});
  }
}
