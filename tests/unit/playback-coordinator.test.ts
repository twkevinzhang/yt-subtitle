import { it, expect, vi, afterEach } from "vitest";
import {
  createPlaybackCoordinator,
  bindPlaybackCoordinator,
} from "../../src/content/playback-coordinator";
afterEach(() => vi.useRealTimers());
const key = { runId: "a", tabId: 0, videoId: "12345678901", draftRevision: 1 };
const progress = (ready: any[] = [], phase = "running") => ({
  key,
  ready,
  phase,
});
function setup() {
  let paused = false;
  const player = {
    paused: () => paused,
    positionMs: () => 0,
    pause: vi.fn(() => {
      paused = true;
    }),
    play: vi.fn(async () => {
      paused = false;
    }),
  };
  const notice = vi.fn();
  return { player, notice, c: createPlaybackCoordinator(player, notice) };
}
it("pauses until buffered then resumes once, never overrides manual pause", async () => {
  const { player, c } = setup();
  c.begin(key, "buffer-before-play");
  c.update(progress());
  expect(player.pause).toHaveBeenCalledTimes(1);
  c.userIntent("pause");
  c.update(progress([{ startMs: 0, endMs: 16000 }]));
  expect(player.play).not.toHaveBeenCalled();
  c.dispose();
});
it("resumes owned pauses once and rejects old seek/run results", async () => {
  const { player, c } = setup();
  c.begin(key, "buffer-before-play");
  c.update(progress());
  c.update(progress([{ startMs: 0, endMs: 16000 }]));
  await Promise.resolve();
  expect(player.play).toHaveBeenCalledTimes(1);
  c.update({ ...progress(), key: { ...key, runId: "old" } });
  expect(player.pause).toHaveBeenCalledTimes(1);
  c.dispose();
});
it("does not fight manual play, and never controls other modes", () => {
  for (const mode of ["background", "complete-before-use"] as const) {
    const { c, player } = setup();
    c.begin(key, mode);
    c.update(progress());
    expect(player.pause).not.toHaveBeenCalled();
    c.dispose();
  }
  const { c, player } = setup();
  c.begin(key, "buffer-before-play");
  c.update(progress());
  c.userIntent("play");
  c.update(progress());
  expect(player.pause).toHaveBeenCalledTimes(1);
  c.dispose();
});
it("bounds loading and buffering waits without renewing timers", async () => {
  vi.useFakeTimers();
  const { c, player, notice } = setup();
  c.begin(key, "buffer-before-play");
  c.update(progress([], "loading"));
  await vi.advanceTimersByTimeAsync(119000);
  expect(player.play).not.toHaveBeenCalled();
  c.update(progress([], "loading"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(player.play).toHaveBeenCalledTimes(1);
  expect(notice).toHaveBeenCalled();
  c.dispose();
});

it("honors an explicit hardware pause even while already paused by the extension", () => {
  const video = document.createElement("video");
  let paused = false;
  Object.defineProperty(video, "paused", { get: () => paused });
  Object.defineProperty(video, "duration", { value: 30 });
  video.pause = vi.fn(() => {
    paused = true;
    video.dispatchEvent(new Event("pause"));
  });
  video.play = vi.fn(async () => {
    paused = false;
    video.dispatchEvent(new Event("play"));
  });
  const c = bindPlaybackCoordinator(video, () => {});
  c.begin(key, "buffer-before-play");
  c.update(progress());
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "MediaPause" }));
  c.update(progress([{ startMs: 0, endMs: 16000 }]));
  expect(video.play).not.toHaveBeenCalled();
  c.dispose();
});
