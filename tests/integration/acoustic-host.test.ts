import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  take: vi.fn(),
  clear: vi.fn(async () => {}),
}));
vi.mock("../../src/acoustic/audio-store", () => ({
  takeJobAudio: mock.take,
  clearJobAudio: mock.clear,
}));
vi.mock("../../src/acoustic/model-session", () => ({
  ModelSession: class {
    state = "ready";
    initializationCount = 1;
    retain() {}
    release() {}
    cancel() {}
    async dispose() {}
    async align({ segment, lines }: any) {
      return lines
        .filter((l: any) => segment.lineIds.includes(l.id))
        .map((l: any) => ({
          ...l,
          startMs: segment.startMs + 10,
          endMs: segment.endMs - 10,
        }));
    }
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function setup() {
  vi.resetModules();
  let listener: any;
  vi.stubGlobal("chrome", {
    runtime: {
      id: "test",
      getURL: (p: string) => "chrome-extension://test/" + p,
      sendMessage: vi.fn(async () => ({ ok: true })),
      onMessage: {
        addListener: (fn: any) => {
          listener = fn;
        },
      },
    },
  });
  mock.take.mockResolvedValue(new Float32Array(16000).buffer);
  await import("../../src/acoustic/offscreen");
  const send = (
    command: string,
    args: Record<string, unknown> = {},
    sender = { id: "test", url: "chrome-extension://test/background.js" },
  ) =>
    new Promise<any>((resolve) =>
      listener({ target: "acoustic-host", command, ...args }, sender, resolve),
    );
  await send("query");
  const input = {
    key: { runId: "r1", tabId: 1, videoId: "e1ZMmRlsaaU", draftRevision: 1 },
    assetId: "r1",
    positionMs: 0,
    lines: [
      {
        id: "l1",
        original: "lyrics",
        cueIds: [],
        status: "unaligned",
        excluded: false,
      },
    ],
    segments: [
      {
        id: "s1",
        lineIds: ["l1"],
        contextLineIds: [],
        startMs: 0,
        endMs: 1000,
        language: "ja",
        evidenceCueIds: ["c1"],
        occurrence: 1,
      },
    ],
  };
  return { send, input };
}
it("rolls back a rejected owner map so later jobs can start", async () => {
  const { send, input } = await setup();
  const invalid = {
    ...input,
    segments: [...input.segments, { ...input.segments[0], id: "s2" }],
  };
  expect((await send("start", { input: invalid })).ok).toBe(false);
  expect((await send("query")).data.phase).not.toBe("running");
  expect((await send("start", { input })).ok).toBe(true);
  await vi.waitFor(async () =>
    expect((await send("query")).data.phase).toBe("complete"),
  );
});
it("holds one owner while audio is being read, rejecting simultaneous starts", async () => {
  const { send, input } = await setup();
  let resolve!: (value: ArrayBuffer) => void;
  mock.take.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const first = send("start", { input });
  await vi.waitFor(() => expect(mock.take).toHaveBeenCalled());
  const second = await send("start", {
    input: { ...input, key: { ...input.key, runId: "r2" }, assetId: "r2" },
  });
  expect(second.ok).toBe(false);
  expect(mock.take).toHaveBeenCalledTimes(1);
  resolve(new Float32Array(16000).buffer);
  expect((await first).ok).toBe(true);
  await vi.waitFor(async () =>
    expect((await send("query")).data.phase).toBe("complete"),
  );
  expect((await send("query")).data.snapshot.key.runId).toBe("r1");
});
it("rejects extension page and outside senders as acoustic controllers", async () => {
  const { send } = await setup();
  expect(
    (
      await send(
        "query",
        {},
        { id: "test", url: "chrome-extension://test/options.html" },
      )
    ).ok,
  ).toBe(false);
});
