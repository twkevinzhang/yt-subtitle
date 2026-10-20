import { afterEach, it, expect, vi } from "vitest";
import { beforeDeadline } from "../../scripts/probe-deadline.mjs";
afterEach(() => vi.useRealTimers());
it("bounds an in-flight decoder drain by the original deadline", async () => {
  vi.useFakeTimers();
  const pending = beforeDeadline(new Promise<void>(() => {}), Date.now() + 90);
  const rejected = expect(pending).rejects.toThrow("hard deadline");
  await vi.advanceTimersByTimeAsync(90);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});
it("clears its timer on completion and does not renew an expired deadline", async () => {
  vi.useFakeTimers();
  await expect(
    beforeDeadline(Promise.resolve(7), Date.now() + 90),
  ).resolves.toBe(7);
  expect(vi.getTimerCount()).toBe(0);
  await expect(
    beforeDeadline(new Promise(() => {}), Date.now() - 1),
  ).rejects.toThrow("hard deadline");
  expect(vi.getTimerCount()).toBe(0);
});
