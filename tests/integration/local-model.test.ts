import { it, expect, vi } from "vitest";
import { LocalModelHost } from "../../src/acoustic/local-model-host";
const key = { tabId: 1, videoId: "12345678901", draftRevision: 1, runId: "a" };
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
