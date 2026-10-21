import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";

const videoId = "e1ZMmRlsaaU";
const result = {
  poToken: "dGVzdC10b2tlbg",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
const request = (body: unknown = { videoId }) =>
  new Request("https://service.test/v1/po-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
describe("Token HTTP API", () => {
  it("bounds anonymous generation frequency before starting more workers", async () => {
    const generate = vi.fn().mockResolvedValue(result);
    const app = createApp({
      generate,
      authorize: () => true,
      maxGenerationsPerMinute: 2,
    });
    expect((await app(request())).status).toBe(200);
    expect((await app(request())).status).toBe(200);
    expect((await app(request())).status).toBe(429);
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it("does not call the provider for health checks or invalid input", async () => {
    const generate = vi.fn();
    const app = createApp({ generate, authorize: () => true });
    expect(
      (await app(new Request("https://service.test/healthz"))).status,
    ).toBe(200);
    for (const body of [
      { videoId: "bad" },
      { videoId, url: "https://evil.test" },
      null,
    ]) {
      expect((await app(request(body))).status).toBe(400);
    }
    expect(generate).not.toHaveBeenCalled();
  });
  it("rejects unauthorized calls before generation", async () => {
    const generate = vi.fn();
    const response = await createApp({ generate, authorize: () => false })(
      request(),
    );
    expect(response.status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
  });
  it("returns video binding and disables response caching", async () => {
    const generate = vi.fn().mockResolvedValue(result);
    const response = await createApp({ generate, authorize: () => true })(
      request(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ videoId, ...result });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(generate.mock.calls[0][0]).toBe(videoId);
  });
  it("rejects concurrent work instead of sharing provider global state", async () => {
    let done!: (value: typeof result) => void;
    const app = createApp({
      generate: () =>
        new Promise((resolve) => {
          done = resolve;
        }),
      authorize: () => true,
    });
    const first = app(request());
    await vi.waitFor(() => expect(done).toBeTypeOf("function"));
    expect((await app(request())).status).toBe(429);
    done(result);
    expect((await first).status).toBe(200);
  });
  it("aborts work on deadline without leaking upstream details", async () => {
    let signal!: AbortSignal;
    const app = createApp({
      authorize: () => true,
      deadlineMs: 20,
      generate: async (_id, s) => {
        signal = s;
        await new Promise((_, reject) =>
          s.addEventListener("abort", () => reject(new Error("secret-token")), {
            once: true,
          }),
        );
        return result;
      },
    });
    const response = await app(request());
    expect(response.status).toBe(504);
    expect(signal.aborted).toBe(true);
    expect(await response.text()).not.toContain("secret-token");
  });
  it("rejects oversized bodies and redacts provider failures", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("secret-token"));
    const app = createApp({ generate, authorize: () => true });
    expect(
      (await app(request({ videoId, extra: "x".repeat(5000) }))).status,
    ).toBe(413);
    const response = await app(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("secret-token");
  });
});
