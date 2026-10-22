import { it, expect, vi } from "vitest";
import { SubtitleCoordinator } from "../../src/subtitle/coordinator";
const video = {
  schemaVersion: 1 as const,
  videoId: "abcdefghijk",
  title: "song",
  channel: "artist",
  description: "",
  durationMs: 10000,
};
it("deduplicates discovery and persists complete timed subtitles without invoking audio", async () => {
  const search = vi.fn(async () => undefined),
    save = vi.fn(async () => {});
  const coordinator = new SubtitleCoordinator({ search, save });
  await Promise.all([
    coordinator.ensure(1, video, 2),
    coordinator.ensure(1, video, 2),
  ]);
  expect(search).toHaveBeenCalledTimes(1);
  const selected = await coordinator.select(1, video.videoId, {
    rawText: "a",
    timings: [{ sourceLineIndex: 0, start: 1, end: 2 }],
  });
  expect(selected.job.phase).toBe("complete");
  expect(selected.cues).toHaveLength(1);
  await coordinator.select(1, video.videoId, { rawText: "b" });
  expect(coordinator.get(1, video.videoId)?.cues?.[0].text).toBe("a");
  expect(coordinator.get(1, video.videoId)?.job.error?.code).toBe(
    "LIBRARY_UNAVAILABLE",
  );
});
it("does not recreate work from a stale video or invalid source", async () => {
  const coordinator = new SubtitleCoordinator({
    search: async () => {},
    save: async () => {},
  });
  await coordinator.ensure(1, video, 1);
  await expect(
    coordinator.select(1, "other", { rawText: "a" }),
  ).rejects.toThrow();
  expect(
    (await coordinator.select(1, video.videoId, { rawText: "a", timings: [] }))
      .job.error?.code,
  ).toBe("INVALID_SOURCE_TIMING");
});
it("restores a complete result without repeating paid discovery", async () => {
  const first = new SubtitleCoordinator({
    search: async () => {},
    save: async () => {},
  });
  await first.ensure(1, video, 1);
  const saved = await first.select(1, video.videoId, {
    rawText: "a",
    timings: [{ sourceLineIndex: 0, start: 1, end: 2 }],
  });
  const search = vi.fn(async () => {}),
    restored = new SubtitleCoordinator({ search, save: async () => {} });
  restored.restore(1, saved);
  expect((await restored.ensure(1, video, 1)).cues?.[0].text).toBe("a");
  expect(search).not.toHaveBeenCalled();
});
it("late discovery updates cannot replace a completed subtitle phase", async () => {
  let update: Parameters<
    ConstructorParameters<typeof SubtitleCoordinator>[0]["search"]
  >[3] = () => {};
  const coordinator = new SubtitleCoordinator({
    search: async (_tab, _video, _signal, onUpdate) => {
      update = onUpdate;
    },
    save: async () => {},
  });
  await coordinator.ensure(1, video, 1);
  await coordinator.select(1, video.videoId, {
    rawText: "a",
    timings: [{ sourceLineIndex: 0, start: 1, end: 2 }],
  });
  update({
    id: "s",
    videoId: video.videoId,
    routes: {
      configured: { phase: "complete", text: "", candidates: [] },
      comments: { phase: "complete", text: "", candidates: [] },
      web: { phase: "complete", text: "", candidates: [] },
    },
  });
  expect(coordinator.get(1, video.videoId)?.job.phase).toBe("complete");
});
it("cancel invalidates a source selection awaiting its library preflight", async () => {
  const coordinator = new SubtitleCoordinator({
    search: async () => {},
    save: async () => {},
  });
  await coordinator.ensure(1, video, 1);
  const selecting = coordinator.select(1, video.videoId, { rawText: "a" });
  coordinator.cancel(1);
  await selecting;
  expect(coordinator.get(1, video.videoId)?.job.phase).toBe("cancelled");
});
