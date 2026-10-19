import { expect, it } from "vitest";
import {
  PcmAudioSource,
  assertAudioSize,
} from "../../src/acoustic/audio-source";
it("rejects oversized input before decoding", () =>
  expect(() => assertAudioSize(64 * 1024 * 1024 + 1)).toThrow());
it("returns only complete ranges, and clears audio after dispose", async () => {
  const source = new PcmAudioSource(new Float32Array(32000));
  expect(source.availableRanges()).toEqual([{ startMs: 0, endMs: 2000 }]);
  expect((await source.read(1000, 2000)).pcm.length).toBe(16000);
  await expect(source.read(0, 2100)).rejects.toThrow();
  source.dispose();
  expect(source.availableRanges()).toEqual([]);
  await expect(source.read(0, 100)).rejects.toThrow();
});
