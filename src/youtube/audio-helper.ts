import { AudioCoverage } from "../acoustic/audio-coverage";
import { MAX_AUDIO_BYTES } from "../acoustic/contracts";
import { inspectAudioInitialization } from "./audio-initialization";

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
  let coverage = new AudioCoverage();
  let bytes = 0,
    lastProgress = performance.now(),
    lastSeek = 0,
    stopped = false;
  let audioBuffer: SourceBuffer | undefined;
  let audioSource: MediaSource | undefined;
  let resets = 0,
    generation = 0,
    sequence = 0,
    seekStart = false;
  let state: "content" | "waiting-ad" | "awaiting-content" = "content";
  const contaminated = new WeakSet<SourceBuffer>();
  const appendGeneration = new WeakMap<SourceBuffer, number>();
  const initialization = new WeakMap<SourceBuffer, Uint8Array>();
  const initializedGeneration = new WeakMap<SourceBuffer, number>();
  const keyDiagnostics = new WeakSet<HTMLVideoElement>();
  const expectedDuration = Number(url.searchParams.get("ai-lyrics-duration"));
  const streaming = url.searchParams.get("ai-lyrics-stream") === "1";
  let requested: { startMs: number; endMs: number } | undefined,
    requestedSeek = false,
    rangeStarted = performance.now(),
    parked = false;
  type Player = HTMLElement & {
    playVideo?(): void;
    pauseVideo?(): void;
    seekTo?(s: number, allow: boolean): void;
    getVideoData?(): { video_id?: string };
  };
  const isAd = (player: Element | null) =>
    !!player &&
    (player.classList.contains("ad-showing") ||
      player.classList.contains("ad-interrupting"));
  const sources = new Map<string, MediaSource>();
  const createObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (value) {
    const key = createObjectURL.call(this, value);
    if (value instanceof MediaSource && sources.size < 100)
      sources.set(key, value);
    return key;
  };
  const started = performance.now();
  const send = (data: Record<string, unknown>, transfer: Transferable[] = []) =>
    parent.postMessage(
      { tag: "ai-lyrics-audio", nonce, ...data },
      location.origin,
      transfer,
    );
  const fail = (message: string, code = "audio-source") => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    window.removeEventListener("message", control);
    (document.querySelector("video") as HTMLVideoElement | null)?.pause();
    send({ type: "error", message, code, state, generation });
  };
  function control(event: MessageEvent) {
    if (
      !streaming ||
      stopped ||
      event.source !== parent ||
      event.origin !== location.origin ||
      event.data?.tag !== "ai-lyrics-control" ||
      event.data?.nonce !== nonce
    )
      return;
    const m = event.data;
    if (m.action === "stop") {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("message", control);
      (document.querySelector("video") as HTMLVideoElement | null)?.pause();
      return;
    }
    if (m.action === "pause") {
      parked = true;
      return;
    }
    if (
      m.action === "range" &&
      Number.isFinite(m.range?.startMs) &&
      Number.isFinite(m.range?.endMs) &&
      m.range.startMs >= 0 &&
      m.range.endMs > m.range.startMs &&
      m.range.endMs - m.range.startMs <= 30000
    ) {
      requested = m.range;
      requestedSeek = true;
      parked = false;
      rangeStarted = performance.now();
      lastProgress = performance.now();
    }
  }
  if (streaming) window.addEventListener("message", control);
  const resetCapture = (reason: string) => {
    generation++;
    coverage = new AudioCoverage();
    bytes = 0;
    sequence = 0;
    lastSeek = 0;
    lastProgress = performance.now();
    seekStart = false;
    audioBuffer = undefined;
    audioSource = undefined;
    if (streaming && requested) {
      parked = false;
      requestedSeek = true;
    }
    send({ type: "reset", reason, generation });
  };
  const observeAd = (player: Element | null) => {
    if (isAd(player)) {
      if (state !== "waiting-ad") {
        // Retained native ranges no longer correspond to the bytes owned by
        // the reset receiver. Do not count them in a fresh capture generation.
        if (audioBuffer) contaminated.add(audioBuffer);
        resetCapture("ad-start");
        state = "waiting-ad";
        send({ type: "status", state, generation });
      }
      return true;
    }
    if (state === "waiting-ad") {
      state = "awaiting-content";
      lastProgress = performance.now();
      send({ type: "status", state, generation });
    }
    return false;
  };
  const original = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (mime) {
    const source = this;
    const buffer = original.call(this, mime);
    if (!mime.startsWith("audio/")) return buffer;
    const append = buffer.appendBuffer;
    buffer.appendBuffer = function (data) {
      if (stopped) return append.call(this, data);
      const video = document.querySelector("video");
      const player = document.querySelector("#movie_player") as Player | null;
      // YouTube may prepare unused MediaSources. Only the source actually
      // attached to this player can contribute bytes or trigger a restart.
      if (!video || sources.get(video.src || video.currentSrc) !== source)
        return append.call(this, data);
      if (observeAd(player)) {
        contaminated.add(buffer);
        initialization.delete(buffer);
        appendGeneration.delete(buffer);
        return append.call(this, data);
      }
      if (video.mediaKeys && !keyDiagnostics.has(video)) {
        keyDiagnostics.add(video);
        send({
          type: "diagnostic",
          code: "media-keys-attached",
          generation,
          message: "播放器附有 mediaKeys；將依音訊初始化資料判斷是否加密",
        });
      }
      let copy = (
        ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data)
      ).slice();
      if (
        state === "awaiting-content" ||
        initializedGeneration.get(buffer) !== generation
      ) {
        if (
          (state === "awaiting-content" &&
            player?.getVideoData?.().video_id !== url.searchParams.get("v")) ||
          (state === "awaiting-content" &&
            expectedDuration > 0 &&
            (!Number.isFinite(video.duration) ||
              Math.abs(video.duration * 1000 - expectedDuration) > 1000)) ||
          (contaminated.has(buffer) && buffer.buffered.length > 0)
        )
          return append.call(this, data);
        const previous = initialization.get(buffer);
        // A fresh header replaces an incomplete/unrelated probe; otherwise join split headers.
        const startsHeader = mime.startsWith("audio/webm")
          ? copy.length >= 4 &&
            copy[0] === 0x1a &&
            copy[1] === 0x45 &&
            copy[2] === 0xdf &&
            copy[3] === 0xa3
          : copy.length >= 8 &&
            ["ftyp", "moov"].includes(
              String.fromCharCode(...copy.subarray(4, 8)),
            );
        if (previous && !startsHeader) {
          if (previous.length + copy.length > 1024 * 1024) {
            fail("音訊初始化資料超過上限", "initialization");
            return append.call(this, data);
          }
          const joined = new Uint8Array(previous.length + copy.length);
          joined.set(previous);
          joined.set(copy, previous.length);
          copy = joined;
        }
        const inspection = inspectAudioInitialization(copy, mime);
        if (inspection === "encrypted") {
          fail(
            "正片音訊初始化資料標示加密，無法用於本機校時",
            "encrypted-audio",
          );
          return append.call(this, data);
        }
        if (inspection !== "clear") {
          if (inspection === "incomplete") initialization.set(buffer, copy);
          else initialization.delete(buffer);
          return append.call(this, data);
        }
        initialization.delete(buffer);
        contaminated.delete(buffer);
        const resumed = state === "awaiting-content";
        state = "content";
        lastProgress = performance.now();
        if (resumed) {
          seekStart = true;
          send({ type: "status", state, generation });
        }
      } else if (inspectAudioInitialization(copy, mime) === "encrypted") {
        fail("正片音訊初始化資料標示加密，無法用於本機校時", "encrypted-audio");
        return append.call(this, data);
      }
      if (audioBuffer !== buffer) {
        if (audioBuffer) {
          if (++resets > 2) {
            fail("音訊來源持續切換，歌詞已保留");
            return append.call(this, data);
          }
          resetCapture("source-change");
          seekStart = true;
        }
        audioBuffer = buffer;
        audioSource = source;
      }
      bytes += copy.byteLength;
      if (bytes > MAX_AUDIO_BYTES) {
        fail("音訊超過 64 MiB 上限");
        return append.call(this, data);
      }
      const result = append.call(this, data);
      initializedGeneration.set(buffer, generation);
      appendGeneration.set(buffer, generation);
      send(
        {
          type: "chunk",
          data: copy.buffer,
          mime,
          generation,
          sequence,
          init: sequence++ === 0,
        },
        [copy.buffer],
      );
      return result;
    };
    buffer.addEventListener("updateend", () => {
      if (stopped) return;
      const video = document.querySelector("video");
      const player = document.querySelector("#movie_player");
      if (observeAd(player)) return;
      if (
        stopped ||
        state !== "content" ||
        appendGeneration.get(buffer) !== generation ||
        audioBuffer !== buffer ||
        !video ||
        sources.get(video.src || video.currentSrc) !== source
      )
        return;
      appendGeneration.delete(buffer);
      const previous = coverage.edge;
      coverage.add(
        Array.from({ length: buffer.buffered.length }, (_, i) => [
          buffer.buffered.start(i),
          buffer.buffered.end(i),
        ]),
      );
      if (coverage.edge > previous) lastProgress = performance.now();
      send({ type: "coverage", edge: coverage.edge, generation });
    });
    const changeType = buffer.changeType;
    if (changeType)
      buffer.changeType = function (type) {
        const video = document.querySelector("video");
        const player = document.querySelector("#movie_player");
        const attached =
          video && sources.get(video.src || video.currentSrc) === source;
        if (attached && observeAd(player)) {
          contaminated.add(buffer);
          initialization.delete(buffer);
          initializedGeneration.delete(buffer);
          const result = changeType.call(this, type);
          mime = type;
          return result;
        }
        if (
          audioBuffer === buffer &&
          video &&
          sources.get(video.src || video.currentSrc) === source
        )
          fail("音訊編碼在同一串流中變更，歌詞已保留；請重新校時");
        const result = changeType.call(this, type);
        mime = type;
        initialization.delete(buffer);
        initializedGeneration.delete(buffer);
        return result;
      };
    return buffer;
  };
  const timer = setInterval(() => {
    if (stopped) return;
    const video = document.querySelector("video");
    const player = document.querySelector("#movie_player") as Player | null;
    if (
      performance.now() - started >= (streaming ? 600000 : 90000) ||
      (streaming &&
        requested &&
        !parked &&
        performance.now() - rangeStarted >= 90000)
    ) {
      fail("音訊擷取達 90 秒總上限，歌詞與已完成結果保留", "deadline");
      return;
    }
    if (!video || !player?.playVideo) return;
    const waitingAd = observeAd(player);
    video.muted = true;
    if (waitingAd) {
      if (video.paused) player.playVideo();
      return;
    }
    if (streaming && parked) {
      player.pauseVideo?.();
      return;
    }
    if (performance.now() - lastProgress > 15000) {
      fail(
        state === "awaiting-content"
          ? "廣告結束後尚無法確認正片音訊初始化與時間軸"
          : "音訊 15 秒沒有進度，請稍後重新校時",
        "no-progress",
      );
      return;
    }
    if (state === "awaiting-content") {
      if (video.paused) player.playVideo();
      return;
    }
    const capturingCurrent =
      !!audioSource &&
      sources.get(video.src || video.currentSrc) === audioSource;
    if (streaming && capturingCurrent && requested) {
      if (requestedSeek) {
        requestedSeek = false;
        seekStart = false;
        player.seekTo?.(requested.startMs / 1000, true);
        return;
      }
      const available = Array.from(
        { length: audioBuffer!.buffered.length },
        (_, i) => [
          audioBuffer!.buffered.start(i),
          audioBuffer!.buffered.end(i),
        ],
      ).find(
        (r) =>
          r[0] <= requested!.startMs / 1000 + 0.04 &&
          r[1] >= requested!.endMs / 1000 - 0.04,
      );
      if (available) {
        parked = true;
        player.pauseVideo?.();
        return;
      }
    }
    if (capturingCurrent && seekStart) {
      seekStart = false;
      player.seekTo?.(0, true);
      return;
    }
    if (!streaming && capturingCurrent && coverage.complete(video.duration)) {
      stopped = true;
      clearInterval(timer);
      player.pauseVideo?.();
      send({
        type: "complete",
        durationMs: Math.round(video.duration * 1000),
        bytes,
        generation,
      });
      return;
    }
    video.muted = true;
    if (video.paused) player.playVideo();
    if (!streaming && capturingCurrent && coverage.edge > lastSeek + 1) {
      lastSeek = coverage.edge;
      player.seekTo?.(Math.max(0, coverage.edge - 0.15), true);
    }
  }, 200);
}
