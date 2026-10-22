import { resolveLibrary } from "./library-loader";
import { readAudio, releaseAudio } from "./audio-store";
import { runUntimed } from "./library-runner";
import type { AudioHandle } from "./audio-provider";
import type { PreparedLyrics } from "./types";
// A single offscreen document hosts sessions; the library itself owns its Worker.
chrome.runtime.onConnect.addListener((port) => {
  if (
    port.name !== "lyric-align-host-v1" ||
    port.sender?.id !== chrome.runtime.id
  )
    return;
  const controller = new AbortController();
  let started = false;
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async (message) => {
    if (message.type === "cancel") {
      controller.abort();
      return;
    }
    if (message.type !== "run" || started) return;
    started = true;
    const { audio, lyrics, language } = message as {
      audio: AudioHandle;
      lyrics: PreparedLyrics;
      language?: string;
    };
    try {
      const binding = await resolveLibrary();
      const result = await runUntimed(
        binding,
        await readAudio(audio),
        lyrics,
        language,
        {
          signal: controller.signal,
          onProgress: (progress) =>
            port.postMessage({ type: "progress", progress }),
        },
      );
      port.postMessage({ type: "result", result });
    } catch (error) {
      const e = error as { code?: string; message?: string };
      try {
        port.postMessage({
          type: "error",
          error: {
            code: e.code ?? "LIBRARY_FAILED",
            message: e.message ?? String(error),
          },
        });
      } catch {}
    } finally {
      await releaseAudio(audio.id).catch(() => {});
    }
  });
});
