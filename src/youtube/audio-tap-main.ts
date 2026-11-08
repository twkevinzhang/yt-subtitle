// Runs in the page's MAIN world at document_start. It only observes the media
// segments YouTube's own player already appends; it never makes a request,
// touches the player's <video>, or alters what is appended.
import {
  TAP_SOURCE,
  DURATION_TOLERANCE_SECONDS,
  cleanWebm,
  concatChunks,
  contiguousCoverage,
  isWebm,
  pcmToBase64,
  type TapResponse,
} from "./audio-tap";

interface TapState {
  chunks: Uint8Array[];
  mime?: string;
  audioBuffers: number;
  version: number;
  url?: string;
  cache?: { version: number; clean: Uint8Array; seconds: number } | undefined;
  inflight?:
    | {
        version: number;
        durationSeconds: number;
        promise: Promise<TapResponse>;
      }
    | undefined;
  answer?:
    | { version: number; durationSeconds: number; response: TapResponse }
    | undefined;
}
const FLAG = "__ytSubtitleAudioTap";
const MAX_STATES = 3;
const states = new Map<MediaSource, TapState>();
const bufferState = new WeakMap<SourceBuffer, TapState>();

function stateFor(source: MediaSource) {
  let state = states.get(source);
  if (!state) {
    state = { chunks: [], audioBuffers: 0, version: 0 };
    states.set(source, state);
    while (states.size > MAX_STATES) states.delete(states.keys().next().value!);
  }
  return state;
}

function install() {
  if ((window as unknown as Record<string, unknown>)[FLAG]) return;
  (window as unknown as Record<string, unknown>)[FLAG] = true;
  const addSourceBuffer = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (this: MediaSource, mime) {
    const buffer = addSourceBuffer.call(this, mime);
    try {
      if (mime.startsWith("audio/")) {
        const state = stateFor(this);
        state.mime = mime.split(";")[0];
        state.audioBuffers++;
        bufferState.set(buffer, state);
      }
    } catch {
      // Observation must never break playback.
    }
    return buffer;
  };
  const appendBuffer = SourceBuffer.prototype.appendBuffer;
  SourceBuffer.prototype.appendBuffer = function (
    this: SourceBuffer,
    data: BufferSource,
  ) {
    try {
      const state = bufferState.get(this);
      if (state) {
        const view =
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        state.chunks.push(view.slice());
        state.version++;
      }
    } catch {
      // Observation must never break playback.
    }
    return appendBuffer.call(this, data);
  };
  const createObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (object: Blob | MediaSource) {
    const url = createObjectURL.call(URL, object);
    try {
      if (object instanceof MediaSource) stateFor(object).url = url;
    } catch {
      // Observation must never break playback.
    }
    return url;
  };
}

function currentState() {
  const video = document.querySelector<HTMLVideoElement>(
    "video.html5-main-video, video",
  );
  const src = video?.currentSrc || video?.src;
  if (!video || !src) return undefined;
  for (const state of states.values()) if (state.url === src) return state;
  return undefined;
}

async function decodeToPcm(webm: Uint8Array) {
  const context = new OfflineAudioContext(1, 1, 16000);
  const buffer = await context.decodeAudioData(
    webm.buffer.slice(
      webm.byteOffset,
      webm.byteOffset + webm.byteLength,
    ) as ArrayBuffer,
  );
  // Fetch each channel once: calling getChannelData per sample freezes the page.
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
    buffer.getChannelData(c),
  );
  const pcm = new Int16Array(buffer.length);
  for (let i = 0; i < pcm.length; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i]!;
    pcm[i] = Math.max(-1, Math.min(1, sum / channels.length)) * 32767;
  }
  return { pcm, seconds: buffer.length / buffer.sampleRate };
}

async function handle(videoId: string, durationSeconds: number) {
  if (new URL(location.href).searchParams.get("v") !== videoId)
    return { status: "unavailable", reason: "video-mismatch" } as const;
  const state = currentState();
  if (!state || !state.chunks.length)
    return {
      status: "pending",
      reason: "no-audio-yet",
      coverageSeconds: 0,
    } satisfies TapResponse;
  if (state.audioBuffers !== 1)
    return { status: "unavailable", reason: "format-changed" } as const;
  const first = state.chunks[0]!;
  if (!isWebm(first))
    return { status: "unavailable", reason: "unsupported-format" } as const;
  if (!state.cache || state.cache.version !== state.version) {
    const { clean, report } = cleanWebm(concatChunks(state.chunks));
    if (report.mixedInit)
      return { status: "unavailable", reason: "format-changed" } as const;
    const coverage = contiguousCoverage(report);
    state.cache = {
      version: state.version,
      clean,
      seconds: coverage.gapped ? 0 : coverage.seconds,
    };
  }
  const { clean, seconds } = state.cache;
  if (seconds < durationSeconds - DURATION_TOLERANCE_SECONDS - 5)
    return {
      status: "pending",
      reason: "buffering",
      coverageSeconds: seconds,
    } satisfies TapResponse;
  // Same appended data and duration: reuse the answer instead of decoding again.
  if (
    state.answer?.version === state.version &&
    state.answer.durationSeconds === durationSeconds
  )
    return state.answer.response;
  const { version } = state;
  if (
    state.inflight?.version !== version ||
    state.inflight.durationSeconds !== durationSeconds
  )
    state.inflight = {
      version,
      durationSeconds,
      promise: decodeAnswer(clean, durationSeconds).then((response) => {
        if (
          response.status !== "unavailable" ||
          response.reason !== "decode-failed"
        )
          state.answer = { version, durationSeconds, response };
        return response;
      }),
    };
  return state.inflight.promise;
}

async function decodeAnswer(
  clean: Uint8Array,
  durationSeconds: number,
): Promise<TapResponse> {
  try {
    const decoded = await decodeToPcm(clean);
    if (
      Math.abs(decoded.seconds - durationSeconds) > DURATION_TOLERANCE_SECONDS
    ) {
      // Segments after the last cluster may not be appended yet.
      return decoded.seconds < durationSeconds
        ? ({
            status: "pending",
            reason: "buffering",
            coverageSeconds: decoded.seconds,
          } satisfies TapResponse)
        : ({ status: "unavailable", reason: "duration-mismatch" } as const);
    }
    return {
      status: "ready",
      sampleRate: 16000,
      pcmBase64: pcmToBase64(decoded.pcm),
      decodedSeconds: decoded.seconds,
    } satisfies TapResponse;
  } catch {
    return { status: "unavailable", reason: "decode-failed" } as const;
  }
}

install();
window.addEventListener("message", (event) => {
  const data = event.data as
    | {
        source?: string;
        kind?: string;
        id?: string;
        videoId?: string;
        durationSeconds?: number;
      }
    | undefined;
  if (
    event.source !== window ||
    data?.source !== TAP_SOURCE ||
    data.kind !== "request" ||
    typeof data.id !== "string" ||
    typeof data.videoId !== "string" ||
    typeof data.durationSeconds !== "number"
  )
    return;
  const id = data.id;
  void handle(data.videoId, data.durationSeconds).then((response) =>
    window.postMessage(
      { source: TAP_SOURCE, kind: "reply", id, response },
      location.origin,
    ),
  );
});
