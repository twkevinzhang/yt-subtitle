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
it("does not retry a rejected play and clips the initial target near the end", async () => {
  let paused = false;
  const play = vi.fn(async () => {
      throw new Error("NotAllowedError");
    }),
    notice = vi.fn();
  const c = createPlaybackCoordinator(
    {
      paused: () => paused,
      positionMs: () => 28000,
      durationMs: () => 30000,
      pause: () => {
        paused = true;
      },
      play,
    },
    notice,
  );
  c.begin(key, "buffer-before-play");
  c.update(progress());
  c.update(progress([{ startMs: 28000, endMs: 30000 }]));
  await Promise.resolve();
  await Promise.resolve();
  c.update(progress([{ startMs: 28000, endMs: 30000 }]));
  expect(play).toHaveBeenCalledTimes(1);
  expect(notice).toHaveBeenCalledWith("瀏覽器未允許自動播放，請點擊播放");
  c.dispose();
});
it("revokes restore ownership for an actual Media Session pause action without a DOM pause event", async () => {
  const handlers: Record<string, any> = {};
  vi.stubGlobal("navigator", {
    mediaSession: {
      setActionHandler: (action: string, handler: any) => {
        handlers[action] = handler;
      },
    },
  });
  const post = vi
    .spyOn(window, "postMessage")
    .mockImplementation((data: any) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data,
          source: window,
          origin: location.origin,
        }),
      );
    });
  const video = document.createElement("video");
  let paused = false;
  Object.defineProperty(video, "paused", { get: () => paused });
  Object.defineProperty(video, "duration", { value: 30 });
  video.pause = vi.fn(() => {
    if (!paused) {
      paused = true;
      video.dispatchEvent(new Event("pause"));
    }
  });
  video.play = vi.fn(async () => {
    paused = false;
    video.dispatchEvent(new Event("play"));
  });
  const { installMediaIntentBridge } =
    await import("../../src/youtube/media-intent");
  const uninstall = installMediaIntentBridge();
  navigator.mediaSession.setActionHandler("pause", () => video.pause());
  const c = bindPlaybackCoordinator(video, () => {});
  c.begin(key, "buffer-before-play");
  c.update(progress());
  handlers.pause({ action: "pause" });
  c.update(progress([{ startMs: 0, endMs: 16000 }]));
  expect(video.play).not.toHaveBeenCalled();
  c.dispose();
  uninstall();
  post.mockRestore();
  vi.unstubAllGlobals();
});
it("keeps automatic resume disabled when Media Session observation cannot be confirmed", async () => {
  vi.stubGlobal("navigator", { mediaSession: { setActionHandler: () => {} } });
  let paused = false;
  const video = document.createElement("video");
  Object.defineProperty(video, "paused", { get: () => paused });
  Object.defineProperty(video, "duration", { value: 30 });
  video.pause = () => {
    paused = true;
    video.dispatchEvent(new Event("pause"));
  };
  video.play = vi.fn(async () => {});
  const notice = vi.fn(),
    c = bindPlaybackCoordinator(video, notice);
  c.begin(key, "buffer-before-play");
  c.update(progress());
  c.update(progress([{ startMs: 0, endMs: 16000 }]));
  await Promise.resolve();
  await Promise.resolve();
  expect(video.play).not.toHaveBeenCalled();
  expect(notice).toHaveBeenCalled();
  c.dispose();
  vi.unstubAllGlobals();
});
it.each(["registered", "removed", "default"])(
  "only auto-resumes with an observable %s Media Session handler",
  async (state) => {
    vi.stubGlobal("navigator", {
      mediaSession: { setActionHandler: () => {} },
    });
    const post = vi
      .spyOn(window, "postMessage")
      .mockImplementation((data: any) =>
        window.dispatchEvent(
          new MessageEvent("message", {
            data,
            source: window,
            origin: location.origin,
          }),
        ),
      );
    const { installMediaIntentBridge } =
      await import("../../src/youtube/media-intent");
    const uninstall = installMediaIntentBridge();
    if (state !== "default")
      navigator.mediaSession.setActionHandler("pause", () => {});
    if (state === "removed")
      navigator.mediaSession.setActionHandler("pause", null);
    const video = document.createElement("video");
    let paused = false;
    Object.defineProperty(video, "paused", { get: () => paused });
    Object.defineProperty(video, "duration", { value: 30 });
    video.pause = () => {
      paused = true;
      video.dispatchEvent(new Event("pause"));
    };
    video.play = vi.fn(async () => {
      paused = false;
      video.dispatchEvent(new Event("play"));
    });
    const c = bindPlaybackCoordinator(video, () => {});
    c.begin(key, "buffer-before-play");
    c.update(progress());
    c.update(progress([{ startMs: 0, endMs: 16000 }]));
    await Promise.resolve();
    expect(video.play).toHaveBeenCalledTimes(state === "registered" ? 1 : 0);
    c.dispose();
    uninstall();
    post.mockRestore();
    vi.unstubAllGlobals();
  },
);
