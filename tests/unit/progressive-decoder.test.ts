import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createProgressiveDecoder } from "../../src/acoustic/progressive-decoder";
const fixture = new Uint8Array(readFileSync("tests/fixtures/audio/tone.webm"));
const outputs: any[] = [];
const decoders: any[] = [];
class Decoder {
  static isConfigSupported = vi.fn(async () => ({ supported: true }));
  state = "configured";
  configure = vi.fn();
  close() {
    this.state = "closed";
  }
  flush = async () => {};
  constructor(public callbacks: any) {
    decoders.push(this);
  }
  decode(chunk: any) {
    this.callbacks.output({
      timestamp: chunk.timestamp,
      sampleRate: 48000,
      numberOfFrames: 960,
      numberOfChannels: 2,
      copyTo(dest: Float32Array) {
        dest.fill(0.25);
      },
      close: vi.fn(),
    });
  }
}
function setup() {
  outputs.length = 0;
  decoders.length = 0;
  vi.stubGlobal("AudioDecoder", Decoder);
  vi.stubGlobal(
    "EncodedAudioChunk",
    class {
      constructor(value: any) {
        Object.assign(this, value);
      }
    },
  );
  return createProgressiveDecoder(
    (range) => outputs.push(range),
    (error) => {
      throw error;
    },
  );
}
function chunk(data: Uint8Array, sequence = 0, generation = 0) {
  return {
    data: data.slice().buffer,
    sequence,
    generation,
    mime: 'audio/webm; codecs="opus"',
    init: sequence === 0,
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("emits_before_eof", async () => {
  const decoder = setup();
  await decoder.push(chunk(fixture.slice(0, Math.floor(fixture.length / 2))));
  expect(outputs.length).toBeGreaterThan(5);
  expect(outputs[0].sampleRate).toBe(16000);
  expect(outputs.every((r) => r.startMs >= 0 && r.pcm.length > 0)).toBe(true);
  decoder.dispose();
});
it("flushes only on terminal finish, after submitted packets", async () => {
  const decoder = setup();
  await decoder.push(chunk(fixture));
  const flush = vi.spyOn(decoders[0], "flush");
  expect(flush).not.toHaveBeenCalled();
  await decoder.finish();
  expect(flush).toHaveBeenCalledTimes(1);
  decoder.dispose();
  await expect(decoder.finish()).rejects.toThrow();
});
it("decodes only the requested window plus Opus preroll rather than an entire native prefetch", async () => {
  setup().dispose();
  outputs.length = 0;
  let wanted = { startMs: 3000, endMs: 4000 };
  const decoder = createProgressiveDecoder(
    (r) => outputs.push(r),
    (e) => {
      throw e;
    },
    () => wanted,
  );
  await decoder.push(chunk(fixture));
  expect(outputs.length).toBeGreaterThan(30);
  expect(outputs.length).toBeLessThan(70);
  expect(outputs[0].startMs).toBeGreaterThanOrEqual(2800);
  expect(outputs.at(-1).startMs).toBeLessThan(4150);
  outputs.length = 0;
  wanted = { startMs: 6000, endMs: 7000 };
  expect(decoder.bufferedBytes()).toBeGreaterThan(0);
  await decoder.decodeRequested();
  expect(outputs.length).toBeGreaterThan(30);
  expect(outputs.length).toBeLessThan(70);
  expect(outputs[0].startMs).toBeGreaterThanOrEqual(5800);
  expect(decoders).toHaveLength(2);
  const close = vi.fn();
  decoders[0].callbacks.output({ close });
  expect(close).toHaveBeenCalledOnce();
  decoder.dispose();
  expect(decoder.bufferedBytes()).toBe(0);
});
it("bounds retained compressed packets and clears them on generation reset", async () => {
  setup().dispose();
  const decoder = createProgressiveDecoder(
    () => {},
    () => {},
    () => ({ startMs: 0, endMs: 1000 }),
  );
  await decoder.push(chunk(fixture));
  const bytes = decoder.bufferedBytes();
  expect(bytes).toBeGreaterThan(0);
  await decoder.push(chunk(fixture, 1));
  expect(decoder.bufferedBytes()).toBe(bytes);
  decoder.reset(1);
  expect(decoder.bufferedBytes()).toBe(0);
  decoder.dispose();
  const bounded = createProgressiveDecoder(
    () => {},
    () => {},
    () => ({ startMs: 0, endMs: 1000 }),
    () => 1,
  );
  await expect(bounded.push(chunk(fixture))).rejects.toThrow(/64 MiB/);
  bounded.dispose();
  expect(bounded.bufferedBytes()).toBe(0);
});
it.each(["between native appends", "during a native queue wait"])(
  "decodes retained earlier packets when the window advances %s",
  async (advanceAt) => {
    setup().dispose();
    if (advanceAt === "during a native queue wait") {
      class QueuedDecoder extends Decoder {
        decodeQueueSize = 0;
        events = new EventTarget();
        addEventListener(type: string, listener: EventListener) {
          this.events.addEventListener(type, listener);
        }
        removeEventListener(type: string, listener: EventListener) {
          this.events.removeEventListener(type, listener);
        }
        decode(packet: any) {
          this.decodeQueueSize++;
          queueMicrotask(() => {
            super.decode(packet);
            this.decodeQueueSize--;
            this.events.dispatchEvent(new Event("dequeue"));
          });
        }
      }
      vi.stubGlobal("AudioDecoder", QueuedDecoder);
    }
    let wanted = { startMs: 0, endMs: 1000 };
    const ranges: { startMs: number; endMs: number }[] = [];
    const decoder = createProgressiveDecoder(
      (range) => {
        const endMs = range.startMs + range.pcm.length / 16;
        const last = ranges.at(-1);
        if (last && last.endMs === range.startMs) last.endMs = endMs;
        else ranges.push({ startMs: range.startMs, endMs });
        expect(range.pcm.every((sample) => sample === 0.25)).toBe(true);
        if (advanceAt === "during a native queue wait" && endMs >= 1000)
          wanted = { startMs: 1000, endMs: 7000 };
      },
      (error) => {
        throw error;
      },
      () => wanted,
    );
    const middle = Math.floor(fixture.length / 2);
    await decoder.push(chunk(fixture.slice(0, middle)));
    expect(decoder.bufferedBytes()).toBeGreaterThan(0);
    wanted = { startMs: 1000, endMs: 7000 };
    // Already queued native appends can run before the caller drains retained packets.
    await decoder.push(chunk(fixture.slice(middle), 1));
    await decoder.decodeRequested();
    expect(ranges.filter((range) => range.endMs > 1000)).toEqual([
      { startMs: 14.5, endMs: 7134.5 },
    ]);
    decoder.dispose();
  },
);
it("preserves a real encoded timestamp gap after draining retained packets", async () => {
  setup().dispose();
  let wanted = { startMs: 0, endMs: 1000 };
  const decoder = createProgressiveDecoder(
    (range) => outputs.push(range),
    (error) => {
      throw error;
    },
    () => wanted,
  );
  await decoder.push(chunk(fixture));
  wanted = { startMs: 0, endMs: 11000 };
  // A new Cluster at 10 seconds, beyond the fixture's eight-second audio.
  const laterCluster = new Uint8Array([
    0x1f, 0x43, 0xb6, 0x75, 0xff, 0xe7, 0x82, 0x27, 0x10, 0xa3, 0x86, 0x81, 0,
    0, 0x80, 0xf8, 0xff,
  ]);
  await decoder.push(chunk(laterCluster, 1));
  await decoder.decodeRequested();
  const previous = outputs.at(-2);
  expect(previous.startMs + previous.pcm.length / 16).toBeLessThan(8100);
  expect(outputs.at(-1).startMs).toBe(9993.5);
  expect(decoders).toHaveLength(2);
  decoder.dispose();
});
it("defers native EOF flush while future packets remain to avoid repeated Opus priming", async () => {
  setup().dispose();
  let wanted = { startMs: 0, endMs: 1000 };
  const decoder = createProgressiveDecoder(
    () => {},
    () => {},
    () => wanted,
  );
  await decoder.push(chunk(fixture));
  const flush = vi.spyOn(decoders.at(-1), "flush");
  await decoder.finish();
  expect(flush).not.toHaveBeenCalled();
  wanted = { startMs: 1000, endMs: 8000 };
  await decoder.decodeRequested();
  expect(decoder.bufferedBytes()).toBe(0);
  expect(flush).toHaveBeenCalledOnce();
  decoder.dispose();
});
it("bounds the native decode queue instead of enqueueing the entire compressed chunk", async () => {
  setup().dispose();
  class QueuedDecoder extends Decoder {
    decodeQueueSize = 0;
    peak = 0;
    events = new EventTarget();
    addEventListener(type: string, listener: EventListener) {
      this.events.addEventListener(type, listener);
    }
    removeEventListener(type: string, listener: EventListener) {
      this.events.removeEventListener(type, listener);
    }
    decode(chunk: any) {
      this.peak = Math.max(this.peak, ++this.decodeQueueSize);
      setTimeout(() => {
        super.decode(chunk);
        this.decodeQueueSize--;
        this.events.dispatchEvent(new Event("dequeue"));
      }, 0);
    }
  }
  vi.stubGlobal("AudioDecoder", QueuedDecoder);
  const decoder = createProgressiveDecoder(
    () => {},
    (e) => {
      throw e;
    },
  );
  await decoder.push(chunk(fixture));
  expect(decoders.at(-1).peak).toBeLessThanOrEqual(64);
  expect(decoders.at(-1).decodeQueueSize).toBe(0);
  decoder.dispose();
});
it("does not renew the five-second watchdog for dequeue notifications without progress", async () => {
  vi.useFakeTimers();
  setup().dispose();
  class StalledDecoder extends Decoder {
    decodeQueueSize = 0;
    events = new EventTarget();
    decode() {
      this.decodeQueueSize++;
    }
    addEventListener(type: string, listener: EventListener) {
      this.events.addEventListener(type, listener);
    }
    removeEventListener(type: string, listener: EventListener) {
      this.events.removeEventListener(type, listener);
    }
  }
  vi.stubGlobal("AudioDecoder", StalledDecoder);
  const decoder = createProgressiveDecoder(
    () => {},
    () => {},
  );
  const pending = decoder.push(chunk(fixture));
  const rejected = expect(pending).rejects.toThrow(/5 秒/);
  await vi.advanceTimersByTimeAsync(4000);
  decoders.at(-1).events.dispatchEvent(new Event("dequeue"));
  await vi.advanceTimersByTimeAsync(1000);
  await rejected;
  expect(decoders.at(-1).state).toBe("closed");
  decoder.dispose();
});
it("split_headers_and_clusters", async () => {
  const decoder = setup();
  for (
    let start = 0, sequence = 0;
    start < fixture.length / 2;
    start += 37, sequence++
  )
    await decoder.push(chunk(fixture.slice(start, start + 37), sequence));
  expect(outputs.length).toBeGreaterThan(5);
  expect(decoders[0].configure).toHaveBeenCalledWith(
    expect.objectContaining({ codec: "opus", numberOfChannels: 2 }),
  );
  decoder.dispose();
});
it("reset_drops_late_decode", async () => {
  const decoder = setup();
  await decoder.push(chunk(fixture.slice(0, fixture.length / 2)));
  const old = decoders[0];
  decoder.reset(1);
  outputs.length = 0;
  const close = vi.fn();
  old.callbacks.output({ close });
  expect(outputs).toHaveLength(0);
  expect(close).toHaveBeenCalled();
  await expect(decoder.push(chunk(fixture.slice(0, 8), 0, 0))).rejects.toThrow(
    /generation/,
  );
  decoder.dispose();
});
it("unsupported_codec_fails_explicitly", async () => {
  const decoder = setup();
  await expect(
    decoder.push({ ...chunk(fixture), mime: "audio/mp4" }),
  ).rejects.toThrow(/不支援/);
  decoder.dispose();
});
it("rejects out of order chunks and unavailable WebCodecs", async () => {
  const decoder = setup();
  await expect(decoder.push(chunk(fixture.slice(0, 5), 2))).rejects.toThrow(
    /sequence/,
  );
  decoder.dispose();
  vi.stubGlobal("AudioDecoder", undefined);
  const absent = createProgressiveDecoder(
    () => {},
    () => {},
  );
  await expect(absent.push(chunk(fixture))).rejects.toThrow(/WebCodecs/);
  absent.dispose();
});
