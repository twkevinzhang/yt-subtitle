import { expect, it, vi } from "vitest";
import { RunManager } from "../../src/background/runs";
it("does not start an AI run while a content audio reservation is active", () => {
  const manager = new RunManager(
    async () => {},
    () => true,
  );
  expect(() => manager.start(2, "video", 1, async () => null)).toThrow();
});
it("adopts an existing acoustic owner and keeps the global busy lock without repeating AI", async () => {
  const persist = vi.fn(async () => {}),
    manager = new RunManager(persist);
  const record: any = {
    state: {
      schemaVersion: 1,
      runId: "old",
      tabId: 1,
      videoId: "video",
      settingsRevision: 1,
      phase: "aligning",
      startedAt: Date.now(),
      deadlineAt: Date.now() + 10000,
      requestCount: 1,
      completedLineIds: [],
    },
  };
  let finish!: () => void;
  manager.adopt(record, async (tools) => {
    expect(tools.runId).toBe("old");
    await new Promise<void>((resolve) => (finish = resolve));
    return { lines: [] };
  });
  expect(() => manager.start(2, "other", 1, async () => null)).toThrow();
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  finish();
  await vi.waitFor(() =>
    expect(manager.get("old")?.state.phase).toBe("complete"),
  );
  expect(manager.get("old")?.state.requestCount).toBe(1);
});
