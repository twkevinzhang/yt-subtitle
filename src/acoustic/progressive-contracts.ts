export interface AudioChunk {
  generation: number;
  sequence: number;
  mime: string;
  data: ArrayBuffer;
  init: boolean;
}
export interface PcmRange {
  generation: number;
  startMs: number;
  sampleRate: 16000;
  pcm: Float32Array;
}
export interface ProgressiveDecoder {
  push(chunk: AudioChunk): Promise<void>;
  decodeRequested(): Promise<void>;
  bufferedBytes(): number;
  finish(): Promise<void>;
  discontinuity(): Promise<void>;
  reset(generation: number): void;
  dispose(): void;
}
