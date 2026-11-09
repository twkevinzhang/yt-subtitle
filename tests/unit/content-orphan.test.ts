import { it, expect, vi } from "vitest";
import { watchExtensionContext, runAll } from "../../src/content/orphan";

it("removes the page UI once the extension context is gone, only once", () => {
  vi.useFakeTimers();
  let alive = true;
  const lost = vi.fn();
  watchExtensionContext(lost, { alive: () => alive, intervalMs: 1000 });
  vi.advanceTimersByTime(3000);
  expect(lost).not.toHaveBeenCalled();
  alive = false;
  vi.advanceTimersByTime(5000);
  expect(lost).toHaveBeenCalledOnce();
  vi.useRealTimers();
});
it("stops watching when asked", () => {
  vi.useFakeTimers();
  const lost = vi.fn();
  const stop = watchExtensionContext(lost, {
    alive: () => false,
    intervalMs: 1000,
  });
  stop();
  vi.advanceTimersByTime(5000);
  expect(lost).not.toHaveBeenCalled();
  vi.useRealTimers();
});
it("keeps cleaning up after a step throws", () => {
  const later = vi.fn();
  runAll([
    () => {
      throw Error("unmount failed");
    },
    later,
  ]);
  expect(later).toHaveBeenCalledOnce();
});
