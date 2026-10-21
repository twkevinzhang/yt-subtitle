import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../src/shared/messages", () => ({ request: mocks.request }));
vi.mock("../../src/acoustic/progressive-decoder", () => ({
  createProgressiveDecoder: () => ({ dispose() {}, bufferedBytes: () => 0 }),
}));
import { createProgressiveAudioSource } from "../../src/acoustic/youtube-stream";
let source: ReturnType<typeof createProgressiveAudioSource> | undefined;
afterEach(() => {
  source?.dispose();
  document.querySelectorAll("iframe").forEach((f) => f.remove());
  vi.clearAllMocks();
});
it("cancels on video disposal and ignores a late Token result", async () => {
  let resolve!: (value: unknown) => void;
  mocks.request.mockImplementation((message) =>
    message.type === "po-token-get"
      ? new Promise((r) => {
          resolve = r;
        })
      : Promise.resolve(),
  );
  source = createProgressiveAudioSource(
    { runId: "run", tabId: 1, videoId: "e1ZMmRlsaaU", draftRevision: 1 },
    100000,
  );
  const pending = source.ensure(
    { startMs: 0, endMs: 26000 },
    new AbortController().signal,
  );
  void pending.catch(() => {});
  const frame = document.querySelector("iframe")!;
  const nonce = new URL(frame.src).searchParams.get("ai-lyrics-audio");
  const post = vi
    .spyOn(frame.contentWindow!, "postMessage")
    .mockImplementation(() => {});
  const emit = (messageNonce: string | null) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "https://www.youtube.com",
        data: {
          tag: "ai-lyrics-audio",
          nonce: messageNonce,
          type: "token-needed",
        },
      }),
    );
  emit("stale-nonce");
  expect(mocks.request).not.toHaveBeenCalled();
  emit(nonce);
  emit(nonce);
  expect(mocks.request).toHaveBeenCalledTimes(1);
  const original = mocks.request.mock.calls[0][0];
  source.dispose();
  expect(mocks.request).toHaveBeenLastCalledWith({
    ...original,
    type: "po-token-cancel",
  });
  post.mockClear();
  resolve({
    videoId: "e1ZMmRlsaaU",
    poToken: "dGVzdA",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(post).not.toHaveBeenCalled();
  expect(frame.isConnected).toBe(false);
});
