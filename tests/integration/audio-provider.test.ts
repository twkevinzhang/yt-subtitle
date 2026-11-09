import { it, expect, vi } from "vitest";
import {
  createAudioProvider,
  type AudioProviderDeps,
} from "../../src/subtitle/audio-provider";
import { pcmToBase64, type TapResponse } from "../../src/youtube/audio-tap";

function setup(
  responses: Array<TapResponse | Error>,
  overrides: Partial<AudioProviderDeps> = {},
) {
  let clock = 0;
  const queue = [...responses];
  const deps: AudioProviderDeps = {
    ask: vi.fn(async () => {
      const next = queue.length > 1 ? queue.shift()! : queue[0]!;
      if (next instanceof Error) throw next;
      return next;
    }),
    cache: {
      getAudio: vi.fn(async () => undefined),
      putAudio: vi.fn(async () => {}),
    },
    stage: vi.fn(async (audio) => ({
      id: "handle",
      sampleRate: 16000 as const,
      sampleCount: audio.pcm.length,
    })),
    sleep: vi.fn(async (ms) => {
      clock += ms;
    }),
    now: () => clock,
    pollMs: 1000,
    deadlineMs: () => 5000,
    ...overrides,
  };
  return { deps, provider: createAudioProvider(deps) };
}
const pending: TapResponse = {
  status: "pending",
  reason: "buffering",
  coverageSeconds: 3,
};
const signal = () => new AbortController().signal;

it("needs a video tab to read audio from", async () => {
  const { provider } = setup([pending]);
  await expect(
    provider.acquire("abcdefghijk", 10, signal()),
  ).rejects.toMatchObject({
    code: "AUDIO_UNAVAILABLE",
  });
});
it("waits while buffering, then stages the finished PCM", async () => {
  const pcm = pcmToBase64(Int16Array.from([0, 16384, -16384]));
  const { provider, deps } = setup([
    pending,
    pending,
    { status: "ready", sampleRate: 16000, pcmBase64: pcm, decodedSeconds: 0 },
  ]);
  const handle = await provider.acquire("abcdefghijk", 10, signal(), 7);
  expect(handle).toEqual({ id: "handle", sampleRate: 16000, sampleCount: 3 });
  expect(deps.ask).toHaveBeenCalledTimes(3);
  expect(deps.ask).toHaveBeenCalledWith(7, "abcdefghijk", 10);
  expect(deps.sleep).toHaveBeenCalledTimes(2);
  expect(Array.from(vi.mocked(deps.stage).mock.calls[0]![0].pcm)).toEqual([
    0, 0.5, -0.5,
  ]);
});
it("fails with the page-reported reason and never stages partial audio", async () => {
  const { provider, deps } = setup([
    { status: "unavailable", reason: "duration-mismatch" },
  ]);
  await expect(
    provider.acquire("abcdefghijk", 10, signal(), 7),
  ).rejects.toMatchObject({
    code: "AUDIO_UNAVAILABLE",
    message: expect.stringContaining("廣告"),
  });
  expect(deps.stage).not.toHaveBeenCalled();
});
it("gives up when the audio never finishes buffering", async () => {
  const { provider, deps } = setup([pending]);
  await expect(
    provider.acquire("abcdefghijk", 10, signal(), 7),
  ).rejects.toMatchObject({
    code: "AUDIO_UNAVAILABLE",
    message: expect.stringContaining("保持影片播放"),
  });
  expect(deps.stage).not.toHaveBeenCalled();
});
it("explains when the tab has no tap (page loaded before the extension)", async () => {
  const { provider } = setup([new Error("Could not establish connection")]);
  await expect(
    provider.acquire("abcdefghijk", 10, signal(), 7),
  ).rejects.toMatchObject({
    code: "AUDIO_UNAVAILABLE",
    message: expect.stringContaining("重新整理"),
  });
});
it("stops polling when cancelled", async () => {
  const controller = new AbortController();
  const { provider } = setup([pending], {
    sleep: vi.fn(async () => {
      controller.abort();
      controller.signal.throwIfAborted();
    }),
  });
  await expect(
    provider.acquire("abcdefghijk", 10, controller.signal, 7),
  ).rejects.toMatchObject({
    name: "AbortError",
  });
});

it("replays from the audio cache without touching the page", async () => {
  const { provider, deps } = setup([pending], {
    cache: {
      getAudio: vi.fn(async () => Int16Array.from([0, 16384])),
      putAudio: vi.fn(async () => {}),
    },
  });
  const handle = await provider.acquire("abcdefghijk", 10, signal());
  expect(handle.sampleCount).toBe(2);
  expect(deps.ask).not.toHaveBeenCalled();
  expect(deps.cache.getAudio).toHaveBeenCalledWith("abcdefghijk", 10);
  expect(Array.from(vi.mocked(deps.stage).mock.calls[0]![0].pcm)).toEqual([
    0, 0.5,
  ]);
});
it("keeps captured audio for next time", async () => {
  const pcm = pcmToBase64(Int16Array.from([0, 16384, -16384]));
  const { provider, deps } = setup([
    { status: "ready", sampleRate: 16000, pcmBase64: pcm, decodedSeconds: 0 },
  ]);
  await provider.acquire("abcdefghijk", 10, signal(), 7);
  expect(deps.cache.putAudio).toHaveBeenCalledWith(
    "abcdefghijk",
    10,
    Int16Array.from([0, 16384, -16384]),
  );
});
it("still works when the cache is broken", async () => {
  const pcm = pcmToBase64(Int16Array.from([0, 16384]));
  const { provider } = setup(
    [{ status: "ready", sampleRate: 16000, pcmBase64: pcm, decodedSeconds: 0 }],
    {
      cache: {
        getAudio: vi.fn(async () => {
          throw Error("quota");
        }),
        putAudio: vi.fn(async () => {
          throw Error("quota");
        }),
      },
    },
  );
  await expect(
    provider.acquire("abcdefghijk", 10, signal(), 7),
  ).resolves.toMatchObject({
    sampleCount: 2,
  });
});

const ready = (): TapResponse => ({
  status: "ready",
  sampleRate: 16000,
  pcmBase64: pcmToBase64(Int16Array.from([0, 16384])),
  decodedSeconds: 0,
});
function withHelper(
  responses: Array<TapResponse | Error>,
  helper: Partial<NonNullable<AudioProviderDeps["helper"]>> = {},
) {
  const calls: string[] = [];
  const full = {
    readyMs: 3000,
    open: vi.fn(async () => {
      calls.push("open");
      return 99;
    }),
    drive: vi.fn(async () => {
      calls.push("drive");
    }),
    close: vi.fn(async () => {
      calls.push("close");
    }),
    ...helper,
  };
  return { calls, full, ...setup(responses, { helper: full }) };
}

it("uses the viewer's tab when its audio is already complete", async () => {
  const { provider, full } = withHelper([ready()]);
  await provider.acquire("abcdefghijk", 10, signal(), 7);
  expect(full.open).not.toHaveBeenCalled();
});
it("opens a background tab, drives it, and always closes it", async () => {
  const { provider, calls, deps } = withHelper([
    new Error("tap not loaded yet"),
    pending,
    pending,
    ready(),
  ]);
  const handle = await provider.acquire("abcdefghijk", 10, signal());
  expect(handle.sampleCount).toBe(2);
  expect(calls).toEqual(["open", "drive", "close"]);
  expect(deps.ask).toHaveBeenCalledWith(99, "abcdefghijk", 10);
});
it("falls back to the background tab when the viewer is still buffering", async () => {
  const { provider, calls } = withHelper([pending, pending, pending, ready()]);
  await provider.acquire("abcdefghijk", 10, signal(), 7);
  expect(calls).toEqual(["open", "drive", "close"]);
});
it("closes the background tab when the audio is unusable", async () => {
  const { provider, calls } = withHelper([
    pending,
    { status: "unavailable", reason: "duration-mismatch" },
  ]);
  await expect(
    provider.acquire("abcdefghijk", 10, signal()),
  ).rejects.toMatchObject({ code: "AUDIO_UNAVAILABLE" });
  expect(calls).toEqual(["open", "drive", "close"]);
});
it("closes the background tab when cancelled", async () => {
  const controller = new AbortController();
  const { provider, calls } = withHelper([pending]);
  const run = provider.acquire("abcdefghijk", 10, controller.signal);
  controller.abort();
  await expect(run).rejects.toBeDefined();
  expect(calls.filter((c) => c === "open").length).toBe(
    calls.filter((c) => c === "close").length,
  );
});
it("reports a tab that never loads the tap and still closes it", async () => {
  const { provider, calls } = withHelper([new Error("no receiver")]);
  await expect(
    provider.acquire("abcdefghijk", 10, signal()),
  ).rejects.toMatchObject({
    code: "AUDIO_UNAVAILABLE",
    message: expect.stringContaining("背景分頁"),
  });
  expect(calls).toEqual(["open", "close"]);
});
it("reports when the background tab cannot be opened", async () => {
  const { provider, full } = withHelper([pending], {
    open: vi.fn(async () => {
      throw Error("blocked");
    }),
  });
  await expect(
    provider.acquire("abcdefghijk", 10, signal()),
  ).rejects.toMatchObject({ code: "AUDIO_UNAVAILABLE" });
  expect(full.close).not.toHaveBeenCalled();
});
