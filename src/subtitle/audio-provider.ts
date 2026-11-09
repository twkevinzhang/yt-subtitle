import { stageAudio } from "./audio-store";
import {
  base64ToInt16,
  int16ToFloat32,
  type TapFailure,
  type TapResponse,
} from "../youtube/audio-tap";
import { subtitleCache, type SubtitleCache } from "./cache-store";

export interface AudioHandle {
  id: string;
  sampleRate: 16000;
  sampleCount: number;
}
export interface AudioProvider {
  acquire(
    videoId: string,
    durationSeconds: number,
    signal: AbortSignal,
    tabId?: number,
  ): Promise<AudioHandle>;
}
export interface AudioProviderDeps {
  ask(
    tabId: number,
    videoId: string,
    durationSeconds: number,
  ): Promise<TapResponse>;
  stage(audio: { pcm: Float32Array; sampleRate: 16000 }): Promise<AudioHandle>;
  /** Decoded audio is kept per video so replays and new lyrics skip capture. */
  cache: Pick<SubtitleCache, "getAudio" | "putAudio">;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now(): number;
  pollMs: number;
  /** How long the viewer has to keep playing until the audio is fully buffered. */
  deadlineMs(durationSeconds: number): number;
  /**
   * A muted background tab the extension opens itself so the player preloads
   * the whole track without touching what the viewer is watching.
   */
  helper?: {
    open(videoId: string, signal: AbortSignal): Promise<number>;
    drive(tabId: number, durationSeconds: number): Promise<void>;
    close(tabId: number): Promise<void>;
    /** How long a freshly opened tab has to load the page-side tap. */
    readyMs: number;
  };
}

const MESSAGES: Record<TapFailure, string> = {
  "video-mismatch": "影片已切換，請在要處理的影片頁面重試。",
  "unsupported-format": "這支影片的音訊格式目前不支援擷取。",
  "format-changed":
    "播放中音訊格式變動，無法取得完整音訊；請重新整理頁面後重試。",
  "duration-mismatch":
    "取得的音訊長度與影片不符（可能混入廣告）；請重新整理頁面，廣告結束後再試。",
  "decode-failed": "音訊解碼失敗。",
};
function unavailable(message: string) {
  return Object.assign(new Error(message), { code: "AUDIO_UNAVAILABLE" });
}

export function createAudioProvider(deps: AudioProviderDeps): AudioProvider {
  return {
    async acquire(videoId, durationSeconds, signal, tabId) {
      signal.throwIfAborted();
      const cached = await deps.cache
        .getAudio(videoId, durationSeconds)
        .catch(() => undefined);
      signal.throwIfAborted();
      if (cached)
        return deps.stage({ pcm: int16ToFloat32(cached), sampleRate: 16000 });

      const finish = async (
        response: Extract<TapResponse, { status: "ready" }>,
      ) => {
        const int16 = base64ToInt16(response.pcmBase64);
        await deps.cache
          .putAudio(videoId, durationSeconds, int16)
          .catch(() => {});
        signal.throwIfAborted();
        return deps.stage({ pcm: int16ToFloat32(int16), sampleRate: 16000 });
      };
      // Waits for the audio of one tab; `viewer` tabs may need the user to keep playing.
      const poll = async (target: number, viewer: boolean) => {
        const deadline = deps.now() + deps.deadlineMs(durationSeconds);
        for (;;) {
          signal.throwIfAborted();
          let response: TapResponse;
          try {
            response = await deps.ask(target, videoId, durationSeconds);
          } catch {
            throw unavailable(
              viewer
                ? "無法連到影片頁面的音訊擷取器；請重新整理 YouTube 頁面（需在影片載入前就啟動）後重試。"
                : "背景分頁的音訊擷取器沒有回應；請重試。",
            );
          }
          signal.throwIfAborted();
          if (response.status === "ready") return finish(response);
          if (response.status === "unavailable")
            throw unavailable(MESSAGES[response.reason]);
          if (deps.now() >= deadline)
            throw unavailable(
              viewer
                ? "音訊尚未載入完整；請保持影片播放（不要暫停或快轉）直到載入完成後重試。"
                : "背景分頁在時限內沒有載入完整音訊；請重試。",
            );
          await deps.sleep(deps.pollMs, signal);
        }
      };

      const helper = deps.helper;
      if (!helper) {
        if (tabId === undefined)
          throw unavailable("找不到要擷取音訊的影片頁面。");
        return poll(tabId, true);
      }
      // Fast path: the viewer's own player may already have buffered everything.
      if (tabId !== undefined) {
        const early = await deps
          .ask(tabId, videoId, durationSeconds)
          .catch(() => undefined);
        signal.throwIfAborted();
        if (early?.status === "ready") return finish(early);
      }
      let helperTab: number;
      try {
        helperTab = await helper.open(videoId, signal);
      } catch {
        signal.throwIfAborted();
        throw unavailable("無法開啟背景分頁來取得音訊。");
      }
      try {
        const readyBy = deps.now() + helper.readyMs;
        for (;;) {
          signal.throwIfAborted();
          try {
            await deps.ask(helperTab, videoId, durationSeconds);
            break;
          } catch {
            if (deps.now() >= readyBy)
              throw unavailable("背景分頁沒有載入音訊擷取器；請重試。");
            await deps.sleep(500, signal);
          }
        }
        await helper.drive(helperTab, durationSeconds).catch(() => {
          throw unavailable("無法在背景分頁啟動音訊載入。");
        });
        return await poll(helperTab, false);
      } finally {
        await helper.close(helperTab).catch(() => {});
      }
    },
  };
}

function abortableSleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Helper tab id -> its popup window and the window to give focus back to. */
const helperWindows = new Map<
  number,
  { windowId: number; returnTo?: number }
>();

/** Audio is read passively from a player's own buffered segments; nothing is downloaded separately. */
export const audioProvider: AudioProvider = createAudioProvider({
  async ask(tabId, videoId, durationSeconds) {
    const reply = (await chrome.tabs.sendMessage(tabId, {
      type: "audio-tap-request",
      videoId,
      durationSeconds,
    })) as { ok: boolean; response?: TapResponse; error?: string } | undefined;
    if (!reply?.ok || !reply.response)
      throw Error(reply?.error ?? "音訊擷取器沒有回應");
    return reply.response;
  },
  stage: stageAudio,
  cache: subtitleCache,
  sleep: abortableSleep,
  now: () => Date.now(),
  pollMs: 1000,
  deadlineMs: (durationSeconds) => (durationSeconds + 60) * 1000,
  helper: {
    readyMs: 30_000,
    // Hidden or covered pages are throttled, so a minimized or background
    // window loads several times slower. The window is raised while it works
    // and closed as soon as the audio is in, handing focus back.
    async open(videoId) {
      if (!/^[\w-]{11}$/.test(videoId)) throw Error("invalid video id");
      const returnTo = (
        await chrome.windows.getLastFocused().catch(() => undefined)
      )?.id;
      const created = await chrome.windows.create({
        url: `https://www.youtube.com/watch?v=${videoId}`,
        type: "popup",
        focused: true,
        width: 480,
        height: 320,
      });
      const tabId = created.tabs?.[0]?.id;
      if (created.id === undefined || tabId === undefined) {
        if (created.id !== undefined)
          await chrome.windows.remove(created.id).catch(() => {});
        throw Error("no tab id");
      }
      helperWindows.set(tabId, { windowId: created.id, returnTo });
      await chrome.tabs.update(tabId, { muted: true }).catch(() => {});
      return tabId;
    },
    async drive(tabId, durationSeconds) {
      const reply = (await chrome.tabs.sendMessage(tabId, {
        type: "audio-tap-drive",
        durationSeconds,
      })) as { ok: boolean } | undefined;
      if (!reply?.ok) throw Error("drive rejected");
    },
    async close(tabId) {
      const entry = helperWindows.get(tabId);
      helperWindows.delete(tabId);
      if (!entry) return chrome.tabs.remove(tabId);
      try {
        await chrome.windows.remove(entry.windowId);
      } finally {
        if (entry.returnTo !== undefined)
          await chrome.windows
            .update(entry.returnTo, { focused: true })
            .catch(() => {});
      }
    },
  },
});
