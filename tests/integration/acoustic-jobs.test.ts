import { expect, it, vi } from "vitest";
import { runAcousticAlignment } from "../../src/background/acoustic-jobs";
it("sends exactly the frozen region body once and publishes a verified segment before completion", async () => {
  const line = {
    id: "l0",
    original: "lyrics",
    cueIds: [],
    status: "unaligned" as const,
    excluded: false,
  };
  const key = {
    runId: "r",
    tabId: 1,
    videoId: "e1ZMmRlsaaU",
    draftRevision: 1,
  };
  const snapshot = {
    key,
    sequence: 1,
    lines: [{ ...line, startMs: 100, endMs: 900 }],
    segments: { s: "verified" },
    modelState: "ready",
  };
  const body = {
    model: "chosen",
    messages: [{ role: "user", content: "frozen" }],
    stream: false,
  };
  const complete = vi.fn(async () =>
    JSON.stringify({
      companions: [],
      segments: [
        {
          id: "s",
          lineIds: ["l0"],
          contextLineIds: [],
          startMs: 0,
          endMs: 1000,
          language: "en",
          evidenceCueIds: ["c0"],
          occurrence: 1,
        },
      ],
    }),
  );
  const calls: string[] = [];
  let queried = 0;
  const host = vi.fn(async (command: string) => {
    calls.push(command);
    return command === "query"
      ? { snapshot, phase: ++queried > 1 ? "complete" : "running" }
      : {};
  });
  const publish = vi.fn(async () => {
    calls.push("publish");
  });
  const tools = {
    runId: "r",
    signal: new AbortController().signal,
    request: async (fn: any) => fn(),
    response: vi.fn(),
    trace: vi.fn(),
    progress: vi.fn(),
    acoustic: publish,
  };
  (tools as any).positionMs = () => 750;
  const output = await runAcousticAlignment(
    {
      key,
      assetId: "a",
      lines: [line],
      cues: [{ id: "c0", text: "lyrics", startMs: 0, endMs: 1000 }],
      durationMs: 1000,
      body,
      positionMs: 0,
    },
    tools,
    { complete, host, wait: async () => {} },
  );
  expect(complete).toHaveBeenCalledExactlyOnceWith(body, tools.signal);
  expect(host).toHaveBeenCalledWith(
    "start",
    expect.objectContaining({
      input: expect.objectContaining({ positionMs: 750 }),
    }),
  );
  expect(publish).toHaveBeenCalled();
  expect(calls.indexOf("publish")).toBeLessThan(calls.lastIndexOf("query"));
  expect(output.lines[0].startMs).toBe(100);
});
it("cancels the owned host if snapshot persistence fails", async () => {
  const { followAcousticJob } =
    await import("../../src/background/acoustic-jobs");
  const key = { runId: "r", tabId: 1, videoId: "v", draftRevision: 1 };
  const host = vi.fn(async () => ({
    phase: "running",
    snapshot: { key, sequence: 1, lines: [] },
  }));
  const tools: any = {
    signal: new AbortController().signal,
    acoustic: async () => {
      throw new Error("session storage failed");
    },
  };
  await expect(followAcousticJob(key, tools, host)).rejects.toThrow(
    "session storage failed",
  );
  expect(host).toHaveBeenCalledWith("cancel", { key });
});
it("cancels an orphan/expired host instead of leaving it running without a restored owner", async () => {
  const { recoveryOwner } = await import("../../src/background/acoustic-jobs");
  const key = { runId: "r", tabId: 1, videoId: "v", draftRevision: 1 };
  const cancel = vi.fn(async () => {});
  const expired: any = {
    state: {
      runId: "r",
      tabId: 1,
      videoId: "v",
      phase: "aligning",
      deadlineAt: 1,
    },
  };
  expect(
    await recoveryOwner(
      { phase: "running", key },
      expired,
      async () => true,
      cancel,
    ),
  ).toBeUndefined();
  expect(cancel).toHaveBeenCalledWith(key);
  cancel.mockClear();
  expect(
    await recoveryOwner(
      { phase: "running", key },
      undefined,
      async () => true,
      cancel,
    ),
  ).toBeUndefined();
  expect(cancel).toHaveBeenCalledWith(key);
});
it("publishes model lifecycle changes even when no new line sequence has completed", async () => {
  const { followAcousticJob } =
    await import("../../src/background/acoustic-jobs");
  const key = { runId: "r", tabId: 1, videoId: "v", draftRevision: 1 };
  const states = ["unloaded", "loading", "ready"];
  let index = 0;
  const host = async () => ({
    phase: index === 2 ? "partial" : "running",
    snapshot: {
      key,
      sequence: 0,
      lines: [],
      modelState: states[index++],
      segments: {},
    },
  });
  const publish = vi.fn(async () => {});
  await followAcousticJob(
    key,
    { signal: new AbortController().signal, acoustic: publish } as any,
    host,
    async () => {},
  );
  expect(publish).toHaveBeenCalledTimes(3);
});
it("cancels a running host and never treats a missing region as aligned", async () => {
  const controller = new AbortController(),
    cancel = vi.fn(async () => ({}));
  const tools = {
    runId: "r",
    signal: controller.signal,
    request: async (fn: any) => fn(),
    response: vi.fn(),
    trace: vi.fn(),
    progress: vi.fn(),
    acoustic: vi.fn(),
  };
  const key = {
    runId: "r",
    tabId: 1,
    videoId: "e1ZMmRlsaaU",
    draftRevision: 1,
  };
  const input = {
    key,
    assetId: "a",
    lines: [],
    cues: [],
    durationMs: 1000,
    body: {},
    positionMs: 0,
  };
  await expect(
    runAcousticAlignment(input, tools, {
      complete: async () => '{"segments":[]}',
      host: cancel,
      wait: async () => {},
    }),
  ).rejects.toThrow("定位");
  expect(cancel).not.toHaveBeenCalledWith("start", expect.anything());
});
it("waits for the preparing owner's snapshot rather than adopting the previous song", async () => {
  const { followAcousticJob } =
    await import("../../src/background/acoustic-jobs");
  const key = { runId: "new", tabId: 1, videoId: "v", draftRevision: 1 };
  let n = 0;
  const snapshot = {
    key,
    sequence: 0,
    lines: [],
    segments: {},
    modelState: "ready",
  };
  const host = vi.fn(async () =>
    ++n === 1
      ? {
          phase: "preparing",
          key,
          snapshot: { ...snapshot, key: { ...key, runId: "old" } },
        }
      : { phase: "complete", key, snapshot },
  );
  const acoustic = vi.fn();
  await expect(
    followAcousticJob(
      key,
      { signal: new AbortController().signal, acoustic } as any,
      host,
      async () => {},
    ),
  ).resolves.toEqual([]);
  expect(acoustic).toHaveBeenCalledTimes(1);
});
