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
it("only starts the latest mode when two changes wait on the same cancelling inference", async () => {
  const jobs: any[] = [];
  m.run.mockImplementation(
    (input, deps) =>
      new Promise((resolve) => jobs.push({ input, deps, resolve })),
  );
  const binding = {
    video: document.createElement("video"),
    container: document.body,
    videoId: "12345678901",
    isAd: () => false,
  };
  const { result, unmount } = renderHook(() =>
    useSubtitleWork(
      binding,
      () => {},
      () => {},
    ),
  );
  await act(async () => {
    void result.current.start([], "background", 10000);
  });
  await act(async () => {
    void result.current.start([], "buffer-before-play", 10000);
    void result.current.start([], "complete-before-use", 10000);
    jobs[0].resolve();
  });
  expect(jobs).toHaveLength(2);
  expect(jobs[1].input.mode).toBe("complete-before-use");
  unmount();
  jobs[1].resolve();
});
it("keeps terminal diagnostics after cancel, isolates diagnostic ticks from draft publications and ignores old jobs", async () => {
  const jobs: any[] = [];
  m.run.mockImplementation(
    (input, deps) =>
      new Promise((resolve) => jobs.push({ input, deps, resolve })),
  );
  const binding = {
    video: document.createElement("video"),
    container: document.body,
    videoId: "12345678901",
    isAd: () => false,
  };
  const publish = vi.fn();
  const { result, unmount } = renderHook(() =>
    useSubtitleWork(binding, publish, () => {}),
  );
  await act(async () => {
    void result.current.start([], "background", 10000);
  });
  await act(async () => {
    jobs[0].deps.onDiagnostics({
      runId: jobs[0].input.key.runId,
      outcome: "running",
      elapsedMs: 4000,
    });
  });
  expect(result.current.diagnostics).toMatchObject({
    outcome: "running",
    elapsedMs: 4000,
  });
  expect(publish).not.toHaveBeenCalled();
  await act(async () => {
    const cancel = result.current.cancel();
    jobs[0].deps.onDiagnostics({
      runId: jobs[0].input.key.runId,
      outcome: "cancelled",
      elapsedMs: 4100,
    });
    jobs[0].resolve();
    await cancel;
  });
  expect(result.current.busy).toBe(false);
  expect(result.current.diagnostics).toMatchObject({
    outcome: "cancelled",
    elapsedMs: 4100,
  });
  await act(async () => {
    void result.current.start([], "background", 10000);
  });
  expect(result.current.diagnostics).toBeUndefined();
  await act(async () => {
    jobs[0].deps.onDiagnostics({ outcome: "failed" });
  });
  expect(result.current.diagnostics).toBeUndefined();
  unmount();
  jobs[1].resolve();
});
