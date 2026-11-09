import { resolveAligner } from "./library-loader";
import { readAudio, releaseAudio } from "./audio-store";
import {
  runUntimed,
  SUPPORTED_LANGUAGES,
  type Aligner,
  type AlignerProgress,
  type CreateAligner,
} from "./library-runner";
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
  // Model preparation starts while the client is still acquiring audio. Its
  // progress is held back so the visible phase only moves once audio is in.
  let prepared: Promise<Aligner> | undefined;
  let consumed = false;
  let lastPrepareEvent: AlignerProgress | undefined;
  let livePrepareProgress: ((event: AlignerProgress) => void) | undefined;
  const disposeUnused = () => {
    if (prepared && !consumed) void prepared.then((a) => a.dispose(), () => {});
  };
  port.onDisconnect.addListener(() => {
    controller.abort();
    disposeUnused();
  });
  port.onMessage.addListener(async (message) => {
    if (message.type === "cancel") {
      controller.abort();
      disposeUnused();
      return;
    }
    if (message.type === "prepare") {
      const language = (message as { language?: string }).language;
      if (prepared || (language && !SUPPORTED_LANGUAGES.includes(language)))
        return;
      prepared = resolveAligner().then((create) =>
        create({
          signal: controller.signal,
          onProgress: (event) => {
            if (livePrepareProgress) livePrepareProgress(event);
            else lastPrepareEvent = event;
          },
        }),
      );
      prepared.catch(() => {});
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
      const createAligner: CreateAligner = prepared
        ? async (options) => {
            consumed = true;
            livePrepareProgress = options.onProgress;
            if (lastPrepareEvent) options.onProgress?.(lastPrepareEvent);
            return prepared!;
          }
        : await resolveAligner();
      const result = await runUntimed(
        createAligner,
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
