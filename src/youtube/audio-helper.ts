import { AudioCoverage } from "../acoustic/audio-coverage";
import { MAX_AUDIO_BYTES } from "../acoustic/contracts";

// MAIN world, document_start, helper frame only. Observe native audio appends;
// the native player still obtains and authorizes all media requests itself.
const url = new URL(location.href),
  nonce = url.searchParams.get("ai-lyrics-audio");
if (
  nonce &&
  /^[a-f0-9-]{36}$/.test(nonce) &&
  parent !== window &&
  location.hostname === "www.youtube.com"
) {
  const coverage = new AudioCoverage();
  let bytes = 0,
    lastProgress = performance.now(),
    lastSeek = 0,
    stopped = false;
  let audioBuffer: SourceBuffer | undefined;
  const started = performance.now();
  const send = (data: Record<string, unknown>, transfer: Transferable[] = []) =>
    parent.postMessage(
      { tag: "ai-lyrics-audio", nonce, ...data },
      location.origin,
      transfer,
    );
  const fail = (message: string) => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    (document.querySelector("video") as HTMLVideoElement | null)?.pause();
    send({ type: "error", message });
  };
  const original = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (mime) {
    const buffer = original.call(this, mime);
    if (!mime.startsWith("audio/")) return buffer;
    if (audioBuffer) {
      fail("音訊格式切換，請重新校時");
      return buffer;
    }
    audioBuffer = buffer;
    const append = buffer.appendBuffer;
    buffer.appendBuffer = function (data) {
      if (stopped) return append.call(this, data);
      const video = document.querySelector("video");
      const player = document.querySelector("#movie_player");
      if (
        video?.mediaKeys ||
        player?.classList.contains("ad-showing") ||
        player?.classList.contains("ad-interrupting")
      ) {
        fail("廣告或加密音訊無法用於校時，歌詞已保留");
        return append.call(this, data);
      }
      const copy = (
        ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data)
      ).slice();
      bytes += copy.byteLength;
      if (bytes > MAX_AUDIO_BYTES) {
        fail("音訊超過 64 MiB 上限");
        return append.call(this, data);
      }
      const result = append.call(this, data);
      send({ type: "chunk", data: copy.buffer }, [copy.buffer]);
      return result;
    };
    buffer.addEventListener("updateend", () => {
      if (stopped) return;
      const previous = coverage.edge;
      coverage.add(
        Array.from({ length: buffer.buffered.length }, (_, i) => [
          buffer.buffered.start(i),
          buffer.buffered.end(i),
        ]),
      );
      if (coverage.edge > previous) lastProgress = performance.now();
      send({ type: "coverage", edge: coverage.edge });
    });
    return buffer;
  };
  const timer = setInterval(() => {
    if (stopped) return;
    const video = document.querySelector("video");
    const player = document.querySelector("#movie_player") as HTMLElement & {
      playVideo?(): void;
      pauseVideo?(): void;
      seekTo?(s: number, allow: boolean): void;
    };
    if (
      performance.now() - started > 90000 ||
      performance.now() - lastProgress > 15000
    ) {
      fail("音訊未能完整載入，請稍後重新校時");
      return;
    }
    if (!video || !player?.playVideo) return;
    if (
      player.classList.contains("ad-showing") ||
      player.classList.contains("ad-interrupting") ||
      video.mediaKeys
    ) {
      fail("廣告或加密音訊無法用於校時，歌詞已保留");
      return;
    }
    if (coverage.complete(video.duration)) {
      stopped = true;
      clearInterval(timer);
      player.pauseVideo?.();
      send({
        type: "complete",
        durationMs: Math.round(video.duration * 1000),
        bytes,
      });
      return;
    }
    video.muted = true;
    if (video.paused) player.playVideo();
    if (coverage.edge > lastSeek + 1) {
      lastSeek = coverage.edge;
      player.seekTo?.(Math.max(0, coverage.edge - 0.15), true);
    }
  }, 200);
}
