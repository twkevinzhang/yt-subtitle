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
afterEach(() => vi.unstubAllGlobals());
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
