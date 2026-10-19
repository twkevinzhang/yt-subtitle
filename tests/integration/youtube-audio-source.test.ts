import { afterEach, expect, it, vi } from "vitest";
import { acquireYouTubeAudio } from "../../src/acoustic/youtube-audio-source";
const request = vi.hoisted(() => vi.fn(async (_message: any) => "asset"));
vi.mock("../../src/shared/messages", () => ({ request }));
afterEach(() => {
  document.querySelectorAll("iframe").forEach((f) => f.remove());
  vi.clearAllMocks();
});
it("claims the bounded upload before loading a helper and removes the helper on cancel", async () => {
  let release!: () => void;
  request.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        release = () => resolve("asset");
      }),
  );
  const controller = new AbortController();
  const promise = acquireYouTubeAudio(
    "12345678901",
    10000,
    controller.signal,
    () => {},
  );
  await Promise.resolve();
  expect(document.querySelector("iframe")).toBeNull();
  release();
  await vi.waitFor(() =>
    expect(document.querySelector("iframe")).not.toBeNull(),
  );
  const rejected = expect(promise).rejects.toThrow("取消");
  controller.abort();
  await rejected;
  expect(document.querySelector("iframe")).toBeNull();
  expect(request).toHaveBeenCalledWith({ type: "audio-clear" });
});
it("discards the previous stream's bytes when the helper resets its active source", async () => {
  const promise = acquireYouTubeAudio(
    "12345678901",
    10000,
    new AbortController().signal,
    () => {},
  );
  await vi.waitFor(() =>
    expect(document.querySelector("iframe")).not.toBeNull(),
  );
  const frame = document.querySelector("iframe")!;
  const nonce = new URL(frame.src).searchParams.get("ai-lyrics-audio");
  const send = (data: Record<string, unknown>) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "https://www.youtube.com",
        data: { tag: "ai-lyrics-audio", nonce, ...data },
      }),
    );
  send({ type: "chunk", data: new Uint8Array([1, 1]).buffer });
  send({ type: "reset" });
  send({ type: "chunk", data: new Uint8Array([2]).buffer });
  send({ type: "complete", bytes: 1, durationMs: 10000 });
  await expect(promise).resolves.toBe("asset");
  const uploads = request.mock.calls
    .map(([m]) => m)
    .filter((m) => m.type === "audio-chunk");
  expect(uploads).toHaveLength(1);
  expect(uploads[0].base64).toBe(btoa(String.fromCharCode(2)));
  expect(document.querySelector("iframe")).toBeNull();
});
