import { afterEach, expect, it, vi } from "vitest";
import { acquireYouTubeAudio } from "../../src/acoustic/youtube-audio-source";
const request = vi.hoisted(() => vi.fn(async () => "asset"));
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
