import { MAX_AUDIO_BYTES, type TimeRange } from "./contracts";
export interface AudioSource {
  availableRanges(): TimeRange[];
  read(
    startMs: number,
    endMs: number,
  ): Promise<{ pcm: Float32Array; sampleRate: 16000 }>;
  dispose(): void;
}
export function assertAudioSize(size: number) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_AUDIO_BYTES)
    throw new Error("音訊輸入須為 64 MiB 以內");
}
export class PcmAudioSource implements AudioSource {
  constructor(private pcm: Float32Array) {
    assertAudioSize(pcm.byteLength);
  }
  availableRanges() {
    return this.pcm.length ? [{ startMs: 0, endMs: this.pcm.length / 16 }] : [];
  }
  async read(startMs: number, endMs: number) {
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      startMs < 0 ||
      endMs <= startMs ||
      endMs - startMs > 30000 ||
      endMs > this.pcm.length / 16
    )
      throw new Error("尚未取得完整片段音訊");
    return {
      pcm: this.pcm.slice(Math.round(startMs * 16), Math.round(endMs * 16)),
      sampleRate: 16000 as const,
    };
  }
  dispose() {
    this.pcm = new Float32Array(0);
  }
}
