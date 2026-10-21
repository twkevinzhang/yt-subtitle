import { expect, it, vi } from "vitest";
import { createPoTokenClient } from "../../src/background/po-token-client";
const videoId = "e1ZMmRlsaaU";
const value = () => ({
  videoId,
  poToken: "dGVzdA",
  expiresAt: new Date(Date.now() + 60000).toISOString(),
});
it("binds the cloud result to the requested video and caches only valid tokens", async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(async () => new Response(JSON.stringify(value())));
  const client = createPoTokenClient({ fetcher });
  const signal = new AbortController().signal;
  expect(await client.get(videoId, signal)).toMatchObject({
    videoId,
    poToken: "dGVzdA",
  });
  await client.get(videoId, signal);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
  });
  const c = new AbortController();
  c.abort();
  await expect(client.get(videoId, c.signal)).rejects.toThrow();
});
it("rejects a wrong video, expired token and oversized response", async () => {
  for (const response of [
    { ...value(), videoId: "aaaaaaaaaaa" },
    { ...value(), expiresAt: "2000-01-01T00:00:00Z" },
    { ...value(), poToken: "x".repeat(9000) },
  ]) {
    const client = createPoTokenClient({
      fetcher: async () => new Response(JSON.stringify(response)),
    });
    await expect(
      client.get(videoId, new AbortController().signal),
    ).rejects.toThrow();
  }
});
it("does not retry HTTP failures or send requests after cancellation", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
  const client = createPoTokenClient({ fetcher });
  await expect(
    client.get(videoId, new AbortController().signal),
  ).rejects.toThrow(/忙碌|額度/);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const c = new AbortController();
  c.abort();
  await expect(client.get(videoId, c.signal)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("aborts an in-flight cloud request on cancellation and at the deadline", async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const client = createPoTokenClient({ fetcher });
    const controller = new AbortController();
    const first = expect(
      client.get(videoId, controller.signal),
    ).rejects.toThrow("aborted");
    controller.abort();
    await first;
    const second = expect(
      client.get(videoId, new AbortController().signal),
    ).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(28000);
    await second;
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
