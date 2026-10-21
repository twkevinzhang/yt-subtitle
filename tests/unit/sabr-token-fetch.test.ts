// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createSabrFetch } from "../../src/youtube/sabr-token-fetch";
const body = new Uint8Array([154, 1, 3, 18, 1, 9]);
it("changes only SABR POST bodies sent to Google Video", async () => {
  const native = vi.fn().mockResolvedValue(new Response());
  const token = vi.fn().mockResolvedValue(new Uint8Array([3, 4]));
  const fetcher = createSabrFetch(native, token);
  await fetcher("https://rr.example.googlevideo.com/videoplayback", {
    method: "POST",
    body,
  });
  const req = native.mock.calls[0][0] as Request;
  expect([...new Uint8Array(await req.arrayBuffer())]).toEqual([
    154, 1, 4, 18, 2, 3, 4,
  ]);
  await fetcher("https://other.test/videoplayback", { method: "POST", body });
  expect(token).toHaveBeenCalledTimes(1);
});
it("does not send a late media request after cancellation while waiting for token", async () => {
  let resolve!: (value: Uint8Array) => void;
  const native = vi.fn();
  const c = new AbortController();
  const fetcher = createSabrFetch(
    native,
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const work = fetcher("https://rr.example.googlevideo.com/videoplayback", {
    method: "POST",
    body,
    signal: c.signal,
  });
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  c.abort();
  resolve(new Uint8Array([1]));
  await expect(work).rejects.toThrow();
  expect(native).not.toHaveBeenCalled();
});
