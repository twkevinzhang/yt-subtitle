import { it, expect } from "vitest";
import { createTimingDiagnostics } from "../../src/acoustic/timing-diagnostics";
import { normalizeSubtitle } from "../../src/lyrics/subtitle-source";
const key = { runId: "r", videoId: "12345678901", tabId: 0, draftRevision: 1 };
it("uses a monotonic clock, includes an active operation and freezes terminal elapsed time", async () => {
  let time = 100;
  const d = createTimingDiagnostics(key, [], { now: () => time });
  await d.measureAsync("recognize", async () => {
    time = 125;
    expect(d.snapshot().active).toMatchObject({
      stage: "recognize",
      elapsedMs: 25,
    });
    time = 160;
  });
  d.decode(20, "ok");
  d.finish("complete");
  time = 99999;
  expect(d.snapshot()).toMatchObject({
    elapsedMs: 60,
    totals: { recognize: { ms: 60, calls: 1 } },
    decode: { ms: 20, calls: 1 },
    active: undefined,
  });
});
it("keeps diagnostic observer overhead out of stage costs and reports it as unattributed wall time", () => {
  let time = 0;
  const d = createTimingDiagnostics(key, [], {
    now: () => time,
    publish: () => {
      time += 5;
    },
  });
  d.measure("match", () => {
    time += 20;
  });
  const report = d.snapshot();
  expect(report.totals.match?.ms).toBe(20);
  expect(report.elapsedMs).toBe(30);
  expect(report.unattributedMs).toBe(10);
});
it("bounds operation and window history while retaining totals and isolating a broken observer", () => {
  let time = 0;
  const d = createTimingDiagnostics(key, [], {
    now: () => time,
    publish: () => {
      throw new Error("observer");
    },
  });
  for (let i = 0; i < 305; i++) {
    const end = d.window({ startMs: 0, endMs: 1000 }, "scan", 0);
    d.measure("match", () => {
      time += 2;
    });
    end("ok");
  }
  expect(d.snapshot()).toMatchObject({
    totals: { match: { ms: 610, calls: 305 } },
    droppedOperations: 5,
    droppedWindows: 105,
  });
  expect(d.snapshot().operations).toHaveLength(300);
  expect(d.snapshot().windows).toHaveLength(200);
});
it("does not count excluded lines or count revisited results twice, and each new run starts a fresh baseline", () => {
  const lines = normalizeSubtitle(
    "first\nsecond\nthird",
    { kind: "paste" },
    4000,
  );
  lines[2].excluded = true;
  const d = createTimingDiagnostics(key, lines);
  const updated = lines.map((l) => ({ ...l, startMs: 0, endMs: 1000 }));
  d.update(updated);
  d.update(updated);
  expect(d.snapshot()).toMatchObject({
    initialTimed: 0,
    newlyTimed: 2,
    pendingCount: 0,
  });
  expect(createTimingDiagnostics(key, updated).snapshot()).toMatchObject({
    initialTimed: 2,
    newlyTimed: 0,
  });
});
it("keeps the business failure stage when cleanup subsequently fails", async () => {
  const d = createTimingDiagnostics(key, []);
  await expect(
    d.measureAsync("recognize", async () => {
      throw new Error("recognizer");
    }),
  ).rejects.toThrow("recognizer");
  await expect(
    d.measureAsync("cleanup", async () => {
      throw new Error("cleanup");
    }),
  ).rejects.toThrow("cleanup");
  d.finish("failed");
  expect(d.snapshot()).toMatchObject({
    interruptedStage: "recognize",
    totals: { recognize: { failed: 1 }, cleanup: { failed: 1 } },
  });
});
