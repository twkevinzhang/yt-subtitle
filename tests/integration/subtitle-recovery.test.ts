import { it, expect, vi } from "vitest";
import { handleMessage } from "../../src/background/index";
const mocks = vi.hoisted(() => ({
  settings: {
    revision: 2,
    provider: { model: "m" },
    preferences: { autoSearchApproved: true },
  },
}));
vi.mock("../../src/background/settings", () => ({
  protectStorage: async () => {},
  getSettings: async () => mocks.settings,
  getPublicSettings: async () => ({}),
  saveSettings: vi.fn(),
  savePreferences: async () => {
    mocks.settings.revision++;
  },
  clearCredentials: vi.fn(),
  normalizeProvider: vi.fn(),
}));
it("snapshot restores persisted work after worker restart without starting paid discovery", async () => {
  const video = {
    schemaVersion: 1,
    videoId: "abcdefghijk",
    title: "s",
    channel: "c",
    description: "",
    durationMs: 10000,
  };
  const source = {
    rawText: "a",
    timings: [{ sourceLineIndex: 0, start: 1, end: 2 }],
  };
  const saved = {
    version: 2,
    video,
    settingsRevision: 2,
    source,
    publishedSource: source,
    publishedSequence: 1,
    job: {
      key: {
        tabId: 42,
        videoId: video.videoId,
        sourceFingerprint: "s",
        generation: 1,
      },
      phase: "complete",
      sequence: 1,
      unmatchedLineIndexes: [],
    },
  };
  vi.stubGlobal("chrome", {
    runtime: { id: "ext" },
    storage: { local: { get: async () => ({ "subtitle-v2:42": saved }) } },
  });
  const sender = {
    id: "ext",
    url: "https://www.youtube.com/watch?v=abcdefghijk",
    frameId: 0,
    tab: { id: 42 },
  };
  const work = (await handleMessage(
    { type: "subtitle-snapshot" },
    sender as chrome.runtime.MessageSender,
  )) as unknown as typeof saved & { cues: { text: string }[] };
  expect(work?.job.phase).toBe("complete");
  expect(work.cues[0].text).toBe("a");
});

it("reads the video from the tab's current address, not the one the page first loaded at", async () => {
  const video = {
    schemaVersion: 1,
    videoId: "abcdefghijk",
    title: "s",
    channel: "c",
    description: "",
    durationMs: 10000,
  };
  const saved = {
    version: 2,
    video,
    settingsRevision: 2,
    job: {
      key: {
        tabId: 43,
        videoId: video.videoId,
        sourceFingerprint: "s",
        generation: 1,
      },
      phase: "selecting",
      sequence: 1,
      unmatchedLineIndexes: [],
    },
  };
  const ask = (tabUrl: string) => {
    vi.stubGlobal("chrome", {
      runtime: { id: "ext" },
      storage: { local: { get: async () => ({ "subtitle-v2:43": saved }) } },
      tabs: { get: async () => ({ url: tabUrl }) },
    });
    return handleMessage({ type: "subtitle-snapshot" }, {
      id: "ext",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      frameId: 0,
      tab: { id: 43 },
    } as chrome.runtime.MessageSender) as Promise<{
      video: { videoId: string };
    } | null>;
  };
  expect(
    (await ask("https://www.youtube.com/watch?v=abcdefghijk"))?.video.videoId,
  ).toBe("abcdefghijk");
  expect(await ask("https://www.youtube.com/watch?v=lmnopqrstuv")).toBeNull();
});
