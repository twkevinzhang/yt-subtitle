import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import {
  stageJobAudio,
  takeJobAudio,
  clearJobAudio,
} from "../../src/acoustic/audio-store";
it("prepares a cold host before staging and consumes input only once", async () => {
  const pcm = new Float32Array([0, 0.25, -0.25]);
  await stageJobAudio("job", pcm.buffer, clearJobAudio);
  expect(Array.from(new Float32Array(await takeJobAudio("job")))).toEqual([
    0, 0.25, -0.25,
  ]);
  await expect(takeJobAudio("job")).rejects.toThrow();
});
