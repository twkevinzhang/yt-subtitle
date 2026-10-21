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

it("rejects a duplicate XHR send synchronously while the first waits for its Token", async () => {
  const nativeSend = vi
    .spyOn(XMLHttpRequest.prototype, "send")
    .mockImplementation(() => {});
  const nativeAbort = vi
    .spyOn(XMLHttpRequest.prototype, "abort")
    .mockImplementation(() => {});
  let resolve!: (token: Uint8Array) => void;
  const onError = vi.fn();
  const stop = installSabrTokenNetwork(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
    onError,
  );
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://rr.example.googlevideo.com/videoplayback");
    const body = new Uint8Array([154, 1, 3, 18, 1, 9]);
    xhr.send(body);
    let error: unknown;
    try {
      xhr.send(body);
    } catch (value) {
      error = value;
    }
    resolve(new Uint8Array([3]));
    await Promise.resolve();
    await Promise.resolve();
    expect(error).toMatchObject({ name: "InvalidStateError" });
    expect(nativeSend).toHaveBeenCalledOnce();
    expect(nativeAbort).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

it("snapshots exactly the XHR body view before waiting for the Token", async () => {
  const nativeSend = vi
    .spyOn(XMLHttpRequest.prototype, "send")
    .mockImplementation(() => {});
  let resolve!: (token: Uint8Array) => void;
  const stop = installSabrTokenNetwork(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
    vi.fn(),
  );
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://rr.example.googlevideo.com/videoplayback");
    const storage = new Uint8Array([88, 154, 1, 5, 8, 1, 18, 1, 9, 99]);
    xhr.send(storage.subarray(1, 9));
    storage[5] = 77;
    resolve(new Uint8Array([3]));
    await Promise.resolve();
    expect([
      ...new Uint8Array(nativeSend.mock.calls[0][0] as ArrayBuffer),
    ]).toEqual([154, 1, 5, 8, 1, 18, 1, 3]);
  } finally {
    stop();
  }
});
