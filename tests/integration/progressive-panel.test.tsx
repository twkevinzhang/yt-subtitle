import { it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useSubtitleWork } from "../../src/ui/use-subtitle-work";
const m = vi.hoisted(() => ({ run: vi.fn(), client: vi.fn(), audio: vi.fn() }));
vi.mock("../../src/acoustic/subtitle-work", () => ({
  runSubtitleAlignment: m.run,
}));
vi.mock("../../src/acoustic/local-model-client", () => ({
  createLocalModelClient: m.client,
}));
vi.mock("../../src/acoustic/youtube-stream", () => ({
  createProgressiveAudioSource: m.audio,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("aborts the old revision before mode switching and ignores late publications", async () => {
  const jobs: any[] = [];
  m.run.mockImplementation(
    (input, deps) =>
      new Promise((resolve) => {
        jobs.push({ input, deps, resolve });
        input.signal.addEventListener("abort", () => resolve(undefined));
      }),
  );
  const publish = vi.fn();
  const binding = {
    video: document.createElement("video"),
    container: document.body,
    videoId: "12345678901",
    isAd: () => false,
  };
  const { result, unmount } = renderHook(() =>
    useSubtitleWork(binding, publish, () => {}),
  );
  await act(async () => {
    void result.current.start([], "background", 10000);
  });
  await act(async () => {
    void result.current.start([], "complete-before-use", 10000);
  });
  expect(jobs[0].input.signal.aborted).toBe(true);
  expect(jobs[1].input.key.draftRevision).toBeGreaterThan(
    jobs[0].input.key.draftRevision,
  );
  await act(async () => {
    jobs[0].deps.publish({ key: jobs[0].input.key, phase: "complete" });
    jobs[1].deps.publish({
      key: jobs[1].input.key,
      phase: "running",
      ready: [],
    });
  });
  expect(publish).toHaveBeenCalledTimes(1);
  unmount();
  expect(jobs[1].input.signal.aborted).toBe(true);
});
