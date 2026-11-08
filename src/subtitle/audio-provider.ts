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
      if (tabId === undefined)
        throw unavailable("找不到要擷取音訊的影片頁面。");
      const deadline = deps.now() + deps.deadlineMs(durationSeconds);
      for (;;) {
        signal.throwIfAborted();
        let response: TapResponse;
        try {
          response = await deps.ask(tabId, videoId, durationSeconds);
        } catch {
          throw unavailable(
            "無法連到影片頁面的音訊擷取器；請重新整理 YouTube 頁面（需在影片載入前就啟動）後重試。",
          );
        }
        signal.throwIfAborted();
        if (response.status === "ready") {
          const int16 = base64ToInt16(response.pcmBase64);
          await deps.cache
            .putAudio(videoId, durationSeconds, int16)
            .catch(() => {});
          signal.throwIfAborted();
          return deps.stage({ pcm: int16ToFloat32(int16), sampleRate: 16000 });
        }
        if (response.status === "unavailable")
          throw unavailable(MESSAGES[response.reason]);
        if (deps.now() >= deadline)
          throw unavailable(
            "音訊尚未載入完整；請保持影片播放（不要暫停或快轉）直到載入完成後重試。",
          );
        await deps.sleep(deps.pollMs, signal);
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

/** Audio is read passively from the viewer's own player; nothing is downloaded. */
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
});
