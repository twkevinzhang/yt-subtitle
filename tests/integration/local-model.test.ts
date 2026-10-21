import { it, expect, vi } from "vitest";
import { LocalModelHost } from "../../src/acoustic/local-model-host";
const key = { tabId: 1, videoId: "12345678901", draftRevision: 1, runId: "a" };
it("converts bounded Japanese text to readings locally without requesting any audio", async () => {
  const read = vi.fn();
  const readings = vi.fn(async () => ["キミノコエ"]);
  const host = new LocalModelHost(
    {
      ensureReady: async () => {},
      transcribe: async () => "",
      align: async () => [],
      cancel: () => {},
      readings,
    },
    read,
  );
  expect(
    await host.infer({ key, operation: "readings", texts: ["君の声"] }),
  ).toEqual(["キミノコエ"]);
  expect(read).not.toHaveBeenCalled();
  expect(readings).toHaveBeenCalledWith(["君の声"]);
  await expect(
    host.infer({ key, operation: "readings", texts: ["あ".repeat(4001)] }),
  ).rejects.toThrow();
});
it("runs local inference on bounded PCM, never sends lyrics to an AI client", async () => {
  const session = {
    ensureReady: vi.fn(async () => {}),
    transcribe: vi.fn(async () => "hello"),
    align: vi.fn(async () => []),
    cancel: vi.fn(),
  };
  const host = new LocalModelHost(
    session,
    async () => new Float32Array(16000).buffer,
  );
  expect(
    await host.infer({
      key,
      operation: "transcribe",
      assetId: "pcm",
      language: "auto",
    }),
  ).toBe("hello");
  expect(session.transcribe).toHaveBeenCalledWith(
    expect.objectContaining({
      pcm: expect.any(Float32Array),
      language: "auto",
    }),
  );
});
it("rejects concurrent requests and invalid PCM", async () => {
  let resolve!: () => void;
  const session = {
    ensureReady: () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
    transcribe: async () => "",
    align: async () => [],
    cancel: vi.fn(),
  };
  const host = new LocalModelHost(
    session,
    async () => new Float32Array(480001).buffer,
  );
  const pending = host.infer({ key, operation: "prepare" });
  await expect(host.infer({ key, operation: "prepare" })).rejects.toThrow(
    /處理/,
  );
  resolve();
  await pending;
  await expect(
    host.infer({
      key,
      operation: "transcribe",
      assetId: "big",
      language: "auto",
    }),
  ).rejects.toThrow(/30/);
});
it("passes recognized surrounding speech through the local host for precise short-line alignment", async () => {
  const align = vi.fn(async () => []);
  const host = new LocalModelHost(
    {
      ensureReady: async () => {},
      transcribe: async () => "",
      align,
      cancel: () => {},
    },
    async () => new Float32Array(16000).buffer,
  );
  await host.infer({
    key,
    operation: "align",
    assetId: "pcm",
    leadingText: "recognized before",
    trailingText: "recognized after",
    lines: [
      {
        id: "line",
        original: "世界はイビツで",
        cueIds: [],
        status: "unaligned",
        excluded: false,
      },
    ],
    segment: {
      id: "s",
      lineIds: ["line"],
      contextLineIds: [],
      startMs: 0,
      endMs: 1000,
      language: "ja",
      evidenceCueIds: [],
      occurrence: 1,
    },
  });
  expect(align).toHaveBeenCalledWith(
    expect.objectContaining({
      leadingText: "recognized before",
      trailingText: "recognized after",
    }),
  );
});
