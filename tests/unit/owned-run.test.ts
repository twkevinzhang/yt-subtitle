import { it, expect, vi } from "vitest";
import { startOwnedRun } from "../../src/ui/owned-run";
it("cancels a late startup response after player unmount", async () => {
  let alive = true;
  let resolve!: (v: any) => void;
  const cancel = vi.fn(async () => {});
  const result = startOwnedRun(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
    () => alive,
    cancel,
  );
  alive = false;
  resolve({ runId: "late" });
  await expect(result).rejects.toThrow();
  expect(cancel).toHaveBeenCalledWith("late");
});
it("does not start after lifecycle ended", async () => {
  const start = vi.fn();
  await expect(
    startOwnedRun(
      start,
      () => false,
      async () => {},
    ),
  ).rejects.toThrow();
  expect(start).not.toHaveBeenCalled();
});
