import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleMessage } from "../../src/background/index";
import { defaults } from "../../src/background/settings";
import { hashInput } from "../../src/background/results";
import { alignmentRequest } from "../../src/lyrics/alignment-request";
import type { RunState } from "../../src/shared/types";
const { completeText } = vi.hoisted(() => ({ completeText: vi.fn() }));
vi.mock("../../src/background/ai-client", () => ({
  createAiClient: () => ({ completeText }),
}));
const sender = {
  id: "id",
  url: "https://www.youtube.com/watch?v=12345678901",
  frameId: 0,
  tab: { id: 1 },
} as chrome.runtime.MessageSender;
beforeEach(() => {
  completeText.mockReset();
  vi.stubGlobal("chrome", {
    runtime: { id: "id" },
    storage: {
      local: {
        get: async () => ({
          settings: {
            ...defaults,
            provider: {
              schemaVersion: 1,
              baseUrl: "https://test/v1",
              apiToken: "test-token",
              model: "m",
            },
            revision: 1,
          },
        }),
        setAccessLevel: async () => {},
      },
      session: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
it("accepts a different AI subtitle count with new text and timestamps in exactly one request", async () => {
  const lines = Array.from({ length: 81 }, (_, i) => ({
    id: `l${i}`,
    original: `歌${i}`,
    status: "unaligned" as const,
    cueIds: [],
    excluded: false,
  }));
  const cues = lines.map((l, i) => ({
    id: `c${i}`,
    startMs: i * 1000,
    endMs: (i + 1) * 1000,
    text: l.original,
  }));
  const raw = JSON.stringify({
    lines: lines.slice(0, 3).map((l, i) => ({
      text: `新版${i}`,
      startMs: i * 1000 + 100,
      endMs: i * 1000 + 900,
      cueIds: [`c${i}`],
      status: "anchor",
    })),
  });
  completeText.mockResolvedValue(raw);
  const body = {
    ...alignmentRequest("edited-model", lines, cues),
    temperature: 0,
  };
  const payload = {
    video: {
      schemaVersion: 1,
      videoId: "12345678901",
      title: "song",
      channel: "",
      description: "",
      durationMs: 90000,
    },
    lines,
    cues,
    targetLanguage: "ja",
    translate: false,
    body,
  };
  const state = (await handleMessage(
    {
      type: "generate",
      input: {
        ...payload,
        consent: {
          purpose: "generate",
          settingsRevision: 1,
          confirmedAt: Date.now(),
          inputHash: await hashInput(payload),
        },
      },
    },
    sender,
  )) as RunState;
  await vi.waitFor(async () => {
    const record = (await handleMessage(
      { type: "run", runId: state.runId },
      sender,
    )) as any;
    expect(record.state.phase).toBe("complete");
    expect(record.state.requestCount).toBe(1);
    expect(record.output.lines).toHaveLength(3);
    expect(record.output.lines.at(-1).startMs).toBe(2100);
    expect(record.output.response).toBe(raw);
  });
  expect(completeText).toHaveBeenCalledTimes(1);
  expect(completeText).toHaveBeenCalledWith(
    expect.any(Array),
    expect.any(AbortSignal),
    body,
  );
});
