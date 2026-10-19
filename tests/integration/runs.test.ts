import { it, expect, vi } from "vitest";
import { RunManager } from "../../src/background/runs";
it("retains bounded raw diagnostics when a run fails", async () => {
  const manager = new RunManager(async () => {});
  const run = manager.start(1, "12345678901", 1, async (tools) => {
    await tools.trace("x".repeat(50000));
    await tools.trace("AI 原始回覆：not-json");
    throw new Error("invalid JSON");
  });
  await vi.waitFor(() =>
    expect(manager.get(run.runId)?.state.phase).toBe("failed"),
  );
  const report = manager.get(run.runId)?.alignmentReport!;
  expect(report).toContain("AI 原始回覆：not-json");
  expect(report).toContain("已截斷");
  expect(report.length).toBeLessThan(40100);
});
it("reserves the final verdict after multiple large AI replies", async () => {
  const manager = new RunManager(async () => {});
  const run = manager.start(1, "12345678901", 1, async (tools) => {
    for (let i = 0; i < 3; i++) await tools.trace(`${i}:` + "x".repeat(16000));
    await tools.trace("逐句判定：l0 因順序衝突被拒絕", true);
    return [];
  });
  await vi.waitFor(() =>
    expect(manager.get(run.runId)?.state.phase).toBe("complete"),
  );
  expect(manager.get(run.runId)?.alignmentReport).toContain(
    "l0 因順序衝突被拒絕",
  );
});
it("cancels late results and rejects simultaneous requests", async () => {
  const m = new RunManager(async () => {});
  let release!: (v: string) => void;
  const state = m.start(1, "12345678901", 1, async ({ request }) =>
    request(
      () =>
        new Promise<string>((r) => {
          release = r;
        }),
    ),
  );
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(() => m.start(1, "12345678901", 1, async () => [])).toThrow();
  m.cancel(state.runId);
  release("late");
  await new Promise((r) => setTimeout(r, 0));
  expect(m.get(state.runId)?.state.phase).toBe("cancelled");
  expect(m.get(state.runId)?.output).toBeUndefined();
});
it("caps request count at twenty", async () => {
  const m = new RunManager(async () => {});
  let calls = 0;
  const state = m.start(1, "12345678901", 1, async ({ request }) => {
    for (let i = 0; i < 21; i++) await request(async () => ++calls);
  });
  await vi.waitFor(() =>
    expect(m.get(state.runId)?.state.phase).toBe("failed"),
  );
  expect(calls).toBe(20);
});
it("handles persist failure without running paid work or unhandled rejection", async () => {
  const m = new RunManager(async () => {
    throw new Error("quota");
  });
  const job = vi.fn();
  const state = m.start(1, "12345678901", 1, job);
  await vi.waitFor(() =>
    expect(m.get(state.runId)?.state.phase).toBe("failed"),
  );
  expect(job).not.toHaveBeenCalled();
});
