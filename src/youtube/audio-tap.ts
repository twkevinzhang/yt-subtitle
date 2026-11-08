// Pure helpers shared by the MAIN-world tap and its tests. No DOM, no chrome.*.
export const TAP_SOURCE = "yt-subtitle-audio-tap";
export const DURATION_TOLERANCE_SECONDS = 1;

export type TapResponse =
  | { status: "pending"; reason: string; coverageSeconds: number }
  | { status: "unavailable"; reason: TapFailure }
  | {
      status: "ready";
      sampleRate: 16000;
      pcmBase64: string;
      decodedSeconds: number;
    };
export type TapFailure =
  | "video-mismatch"
  | "unsupported-format"
  | "format-changed"
  | "duration-mismatch"
  | "decode-failed";

export interface WebmReport {
  headers: number;
  clusters: number;
  unique: number;
  duplicates: number;
  firstMs: number | null;
  lastMs: number | null;
  medianStepMs: number;
  maxStepMs: number;
  mixedInit: boolean;
  error: string | null;
}

const CLUSTER = 0x1f43b675;
const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const TIMECODE = 0xe7;

interface Vint {
  value: number;
  length: number;
  unknown: boolean;
}
function readVint(bytes: Uint8Array, at: number, keepMarker: boolean): Vint {
  const first = bytes[at];
  if (first === undefined || first === 0) throw Error("invalid vint");
  let length = 1;
  let mask = 0x80;
  while (!(first & mask)) {
    length++;
    mask >>= 1;
  }
  let value = keepMarker ? first : first & (mask - 1);
  for (let i = 1; i < length; i++) {
    const byte = bytes[at + i];
    if (byte === undefined) throw Error("truncated vint");
    value = value * 256 + byte;
  }
  return {
    value,
    length,
    unknown: !keepMarker && value === Math.pow(2, 7 * length) - 1,
  };
}
function fingerprint(bytes: Uint8Array) {
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return `${bytes.length}:${hash}`;
}

export function isWebm(bytes: Uint8Array) {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  );
}

/**
 * Rebuilds one playable WebM from MSE appends: first init segment, then each
 * Cluster once, ordered by timecode. A player can re-append segments (seek,
 * retry); concatenating them blindly duplicates audio and shifts timestamps.
 */
export function cleanWebm(bytes: Uint8Array): {
  clean: Uint8Array;
  report: WebmReport;
} {
  const report: WebmReport = {
    headers: 0,
    clusters: 0,
    unique: 0,
    duplicates: 0,
    firstMs: null,
    lastMs: null,
    medianStepMs: 0,
    maxStepMs: 0,
    mixedInit: false,
    error: null,
  };
  const clusters = new Map<number, Uint8Array>();
  const inits = new Set<string>();
  let firstClusterAt = -1;
  let regionStart: number | null = null;
  let at = 0;
  try {
    while (at < bytes.length) {
      const id = readVint(bytes, at, true);
      const size = readVint(bytes, at + id.length, false);
      const header = id.length + size.length;
      if (id.value === EBML) {
        report.headers++;
        regionStart = at;
        at += header + size.value;
        continue;
      }
      if (id.value === SEGMENT) {
        at += header;
        continue;
      }
      if (id.value === CLUSTER) {
        if (size.unknown) throw Error("unknown cluster size");
        if (regionStart !== null) {
          inits.add(fingerprint(bytes.subarray(regionStart, at)));
          regionStart = null;
        }
        if (firstClusterAt < 0) firstClusterAt = at;
        const end = at + header + size.value;
        if (end > bytes.length) throw Error("truncated cluster");
        let child = at + header;
        let timecode: number | null = null;
        while (child < end) {
          const childId = readVint(bytes, child, true);
          const childSize = readVint(bytes, child + childId.length, false);
          const bodyAt = child + childId.length + childSize.length;
          if (childId.value === TIMECODE) {
            timecode = 0;
            for (let i = 0; i < childSize.value; i++)
              timecode = timecode * 256 + bytes[bodyAt + i]!;
            break;
          }
          child = bodyAt + childSize.value;
        }
        if (timecode === null) throw Error("cluster without timecode");
        report.clusters++;
        if (clusters.has(timecode)) report.duplicates++;
        else clusters.set(timecode, bytes.subarray(at, end));
        at = end;
        continue;
      }
      if (size.unknown) throw Error("unknown-size element");
      at += header + size.value;
    }
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  }
  report.mixedInit = inits.size > 1;
  const timecodes = [...clusters.keys()].sort((a, b) => a - b);
  report.unique = timecodes.length;
  if (timecodes.length) {
    report.firstMs = timecodes[0]!;
    report.lastMs = timecodes[timecodes.length - 1]!;
    const steps = timecodes.slice(1).map((t, i) => t - timecodes[i]!);
    report.maxStepMs = Math.max(0, ...steps);
    const sorted = [...steps].sort((a, b) => a - b);
    report.medianStepMs = sorted[(sorted.length - 1) >> 1] ?? 0;
  }
  const head = bytes.subarray(0, Math.max(0, firstClusterAt));
  const parts = timecodes.map((t) => clusters.get(t)!);
  const clean = new Uint8Array(
    head.length + parts.reduce((n, p) => n + p.length, 0),
  );
  clean.set(head, 0);
  let offset = head.length;
  for (const part of parts) {
    clean.set(part, offset);
    offset += part.length;
  }
  return { clean, report };
}

export function concatChunks(chunks: readonly Uint8Array[]) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Seconds of audio the collected clusters already cover, or null if gapped. */
export function contiguousCoverage(report: WebmReport) {
  if (report.error || report.lastMs === null || report.firstMs === null)
    return { seconds: 0, gapped: false };
  const step = report.medianStepMs || 10000;
  return {
    seconds: (report.lastMs + step) / 1000,
    gapped: report.maxStepMs > step * 2,
  };
}

export function pcmToBase64(pcm: Int16Array) {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export function base64ToInt16(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
}
export function int16ToFloat32(int16: Int16Array) {
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) out[i] = int16[i]! / 32768;
  return out;
}
export function base64ToFloat32(base64: string) {
  return int16ToFloat32(base64ToInt16(base64));
}
