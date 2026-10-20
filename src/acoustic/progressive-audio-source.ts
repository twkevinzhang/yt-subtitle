import type { AudioSource } from "./audio-source";
import { MAX_AUDIO_BYTES, type TimeRange } from "./contracts";
import type { PcmRange } from "./progressive-contracts";

/** Only decoded PCM defines availability. Native media buffered ranges never enter this store. */
export class RangeAudioSource implements AudioSource {
  generation = 0;
  private chunks: PcmRange[] = [];
  private listeners = new Set<() => void>();
  private pins = new Set<TimeRange>();
  private disposed = false;
  private error?: Error;
  private peak = 0;
  constructor(
    readonly durationMs: number,
    private requestRange: (range: TimeRange) => void,
    private maxBytes = MAX_AUDIO_BYTES,
    private cleanup: () => void = () => {},
  ) {}
  stats() {
    return {
      pcmBytes: this.chunks.reduce((n, c) => n + c.pcm.byteLength, 0),
      peakPcmBytes: this.peak,
      generation: this.generation,
    };
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private notify() {
    for (const listener of [...this.listeners]) listener();
  }
  fail(error: Error) {
    this.error = error;
    this.notify();
  }
  reset(generation: number) {
    if (generation <= this.generation) return;
    this.generation = generation;
    this.chunks = [];
    this.notify();
  }
  append(chunk: PcmRange) {
    if (this.disposed || chunk.generation !== this.generation) return;
    if (
      chunk.sampleRate !== 16000 ||
      chunk.startMs < 0 ||
      !Number.isFinite(chunk.startMs) ||
      chunk.pcm.some((v) => !Number.isFinite(v))
    )
      throw new Error("PCM 區間無效");
    const count = Math.min(
      chunk.pcm.length,
      Math.max(0, Math.round((this.durationMs - chunk.startMs) * 16)),
    );
    if (!count) return;
    const copy = { ...chunk, pcm: chunk.pcm.slice(0, count) };
    if (copy.pcm.byteLength > this.maxBytes) throw new Error("PCM 超過 64 MiB");
    // Decoder emits non-overlapping ranges in a generation; don't replace trusted samples.
    if (
      this.chunks.some(
        (c) =>
          c.startMs <= copy.startMs &&
          c.startMs + c.pcm.length / 16 >= copy.startMs + copy.pcm.length / 16,
      )
    )
      return;
    this.chunks.push(copy);
    this.chunks.sort((a, b) => a.startMs - b.startMs);
    while (this.stats().pcmBytes > this.maxBytes) {
      const index = this.chunks.findIndex(
        (c) =>
          !this.pins.size ||
          ![...this.pins].some(
            (p) =>
              c.startMs < p.endMs && c.startMs + c.pcm.length / 16 > p.startMs,
          ),
      );
      if (index < 0) {
        this.fail(new Error("在途音訊超過 64 MiB"));
        return;
      }
      this.chunks.splice(index, 1);
    }
    this.peak = Math.max(this.peak, this.stats().pcmBytes);
    this.notify();
  }
  availableRanges(): TimeRange[] {
    const ranges: TimeRange[] = [];
    for (const c of this.chunks) {
      const endMs = c.startMs + c.pcm.length / 16,
        last = ranges.at(-1);
      if (last && Math.round(c.startMs * 16) <= Math.round(last.endMs * 16))
        last.endMs = Math.max(last.endMs, endMs);
      else ranges.push({ startMs: c.startMs, endMs });
    }
    return ranges;
  }
  private has(r: TimeRange) {
    return this.availableRanges().some(
      (a) =>
        Math.round(a.startMs * 16) <= Math.round(r.startMs * 16) &&
        Math.round(a.endMs * 16) >= Math.round(r.endMs * 16),
    );
  }
  ensure(range: TimeRange, signal: AbortSignal): Promise<void> {
    if (this.disposed || signal.aborted)
      return Promise.reject(new Error("音訊已取消"));
    if (this.error) return Promise.reject(this.error);
    if (
      range.startMs < 0 ||
      range.endMs <= range.startMs ||
      range.endMs > this.durationMs ||
      range.endMs - range.startMs > 30000
    )
      return Promise.reject(new Error("音訊區間不合法"));
    if (this.has(range)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.pins.add(range);
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.delete(check);
        this.pins.delete(range);
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        reject(new Error("音訊已取消"));
      };
      const check = () => {
        if (this.error || this.disposed) {
          cleanup();
          reject(this.error ?? new Error("音訊已停止"));
        } else if (this.has(range)) {
          cleanup();
          resolve();
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("區間取得達 90 秒上限"));
      }, 90000);
      this.listeners.add(check);
      signal.addEventListener("abort", abort, { once: true });
      try {
        this.requestRange(range);
        check();
      } catch (e) {
        cleanup();
        reject(e);
      }
    });
  }
  async read(
    startMs: number,
    endMs: number,
  ): Promise<{ pcm: Float32Array; sampleRate: 16000 }> {
    if (
      this.disposed ||
      !this.has({ startMs, endMs }) ||
      endMs <= startMs ||
      endMs - startMs > 30000
    )
      throw new Error("尚未取得完整 PCM 區間");
    const start = Math.round(startMs * 16),
      end = Math.round(endMs * 16),
      pcm = new Float32Array(end - start);
    for (const c of this.chunks) {
      const from = Math.max(start, Math.round(c.startMs * 16)),
        to = Math.min(end, Math.round(c.startMs * 16) + c.pcm.length);
      if (to > from)
        pcm.set(
          c.pcm.subarray(
            from - Math.round(c.startMs * 16),
            to - Math.round(c.startMs * 16),
          ),
          from - start,
        );
    }
    return { pcm, sampleRate: 16000 };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.chunks = [];
    this.notify();
    this.listeners.clear();
    this.cleanup();
  }
}
