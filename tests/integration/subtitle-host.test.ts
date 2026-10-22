import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import {
  stageAudio,
  readAudio,
  releaseAudio,
  clearAudio,
} from "../../src/subtitle/audio-store";
import { SubtitleCoordinator } from "../../src/subtitle/coordinator";
const video = {
  schemaVersion: 1 as const,
  videoId: "abcdefghijk",
  title: "song",
  channel: "artist",
  description: "",
  durationMs: 10000,
};
it("removes orphan PCM before a new host lifecycle", async () => {
  const handle = await stageAudio({
    pcm: new Float32Array([0]),
    sampleRate: 16000,
  });
  await clearAudio();
  await expect(readAudio(handle)).rejects.toMatchObject({
    code: "AUDIO_UNAVAILABLE",
  });
});
it("shares actual PCM through IndexedDB and removes the handle", async () => {
  const audio = {
    pcm: new Float32Array([0.5, 0, -0.5]),
    sampleRate: 16000 as const,
  };
  const handle = await stageAudio(audio);
  expect(Array.from((await readAudio(handle)).pcm)).toEqual(
    Array.from(audio.pcm),
  );
  await releaseAudio(handle.id);
  await expect(readAudio(handle)).rejects.toMatchObject({
    code: "AUDIO_UNAVAILABLE",
  });
});
it("does not publish incomplete output or a late result after cancellation", async () => {
  let finish!: (result: any) => void;
  const align = vi.fn(
    async () =>
      new Promise<any>((resolve) => {
        finish = resolve;
      }),
  );
  const coordinator = new SubtitleCoordinator({
    search: async () => {},
    save: async () => {},
    align,
  });
  await coordinator.ensure(1, video, 1, false);
  await coordinator.select(1, video.videoId, {
    rawText: "old",
    timings: [{ sourceLineIndex: 0, start: 0, end: 1 }],
  });
  const pending = coordinator.select(1, video.videoId, { rawText: "new" });
  await vi.waitFor(() => expect(align).toHaveBeenCalled());
  coordinator.cancel(1);
  finish({
    kind: "complete",
    cues: [{ text: "new", sourceLineIndex: 0, startMs: 0, endMs: 1000 }],
  });
  await pending;
  expect(coordinator.get(1, video.videoId)?.cues?.[0].text).toBe("old");
  align.mockImplementationOnce(async () => ({
    kind: "incomplete",
    lineIndexes: [0],
  }));
  const incomplete = await coordinator.select(1, video.videoId, {
    rawText: "new",
  });
  expect(incomplete.job.unmatchedLineIndexes).toEqual([0]);
  expect(incomplete.cues?.[0].text).toBe("old");
});
