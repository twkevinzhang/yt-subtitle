import { expect, it, vi, afterEach } from "vitest";
import { installSabrTokenNetwork } from "../../src/youtube/sabr-token-network";
afterEach(() => vi.restoreAllMocks());
it("does not report unrelated fetch failures as Token failures", async () => {
  const failure = new TypeError("network failure");
  const native = window.fetch;
  window.fetch = vi.fn().mockRejectedValue(failure);
  const getToken = vi.fn(),
    onError = vi.fn();
  const stop = installSabrTokenNetwork(getToken, onError);
  try {
    await expect(
      window.fetch("https://www.youtube.com/youtubei/v1/log_event"),
    ).rejects.toBe(failure);
    expect(getToken).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  } finally {
    stop();
    window.fetch = native;
  }
});
it("does not send an XHR after the helper has been disposed", async () => {
  const nativeSend = vi
    .spyOn(XMLHttpRequest.prototype, "send")
    .mockImplementation(() => {});
  let resolve!: (value: Uint8Array) => void;
  const stop = installSabrTokenNetwork(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
    vi.fn(),
  );
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "https://rr.example.googlevideo.com/videoplayback");
  xhr.send(new Uint8Array([154, 1, 3, 18, 1, 9]));
  stop();
  resolve(new Uint8Array([3]));
  await Promise.resolve();
  await Promise.resolve();
  expect(nativeSend).not.toHaveBeenCalled();
});
