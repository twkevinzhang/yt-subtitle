import { afterEach, expect, it, vi } from "vitest";
let constructors = 0;
vi.mock("../../src/acoustic/webm-demuxer", () => ({
  WebmDemuxer: class {
    constructor(private track: Function, private packet: Function) {}
    push() {
      this.track({ channels: 2, description: new Uint8Array(19) });
      for (const timestampUs of [0, 51000, 120000, 171000, 240000])
        this.packet({ timestampUs, durationUs: 60000, data: new Uint8Array([1]) });
    }
  },
}));
import { createProgressiveDecoder } from "../../src/acoustic/progressive-decoder";
afterEach(() => vi.unstubAllGlobals());
it("keeps one codec sequence for the observed MediaRecorder ±9ms packet timestamp jitter", async () => {
  constructors = 0;
  class Decoder {
    static async isConfigSupported() { return { supported: true }; }
    state = "configured";
    decodeQueueSize = 0;
    constructor() { constructors++; }
    configure() {}
    decode() {}
    async flush() {}
    close() { this.state = "closed"; }
  }
  vi.stubGlobal("AudioDecoder", Decoder);
  vi.stubGlobal("EncodedAudioChunk", class { constructor(value: object) { Object.assign(this, value); } });
  const decoder = createProgressiveDecoder(() => {}, () => {});
  await decoder.push({ generation: 0, sequence: 0, init: true, mime: "audio/webm", data: new ArrayBuffer(1) });
  expect(constructors).toBe(1);
  decoder.dispose();
});
