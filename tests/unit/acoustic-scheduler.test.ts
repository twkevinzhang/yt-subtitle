import { expect, it, vi } from "vitest";
import { createScheduler } from "../../src/acoustic/scheduler";
import { validateSegment } from "../../src/acoustic/validate-segment";
import { mergeSegment, createSnapshot } from "../../src/acoustic/snapshot";
import type { Segment } from "../../src/acoustic/contracts";
const key = {
  runId: "run",
  tabId: 1,
  videoId: "e1ZMmRlsaaU",
  draftRevision: 1,
};
const lines = [0, 1, 2].map((i) => ({
  id: `l${i}`,
  original: `line ${i}`,
  cueIds: [],
  excluded: false,
  status: "unaligned" as const,
}));
const segments: Segment[] = lines.map((l, i) => ({
  id: `s${i}`,
  lineIds: [l.id],
  contextLineIds: [],
  startMs: i * 10000,
  endMs: (i + 1) * 10000,
  language: "en",
  evidenceCueIds: ["c1"],
  occurrence: 1,
}));
it("prioritizes current, forward, then earlier without duplicating owners", async () => {
  const order: string[] = [];
  const audio = {
    availableRanges: () => [{ startMs: 0, endMs: 30000 }],
    read: async () => ({
      pcm: new Float32Array(160000),
      sampleRate: 16000 as const,
    }),
    dispose() {},
  };
  const session = {
    retain() {},
    release() {},
    cancel() {},
    align: async ({ segment }: any) => {
      order.push(segment.id);
      return [];
    },
  };
  const scheduler = createScheduler(
    segments,
    lines,
    audio,
    session,
    async () => {},
  );
  scheduler.updatePosition(15000);
  await scheduler.run(new AbortController().signal);
  expect(order).toEqual(["s1", "s2", "s0"]);
});
it("does not infer unavailable audio or publish a late cancelled result", async () => {
  const align = vi.fn();
  const scheduler = createScheduler(
    segments,
    lines,
    { availableRanges: () => [], read: vi.fn(), dispose() {} },
    { retain() {}, release() {}, cancel() {}, align },
    async () => {},
  );
  const states = await scheduler.run(new AbortController().signal);
  expect(align).not.toHaveBeenCalled();
  expect(Object.values(states)).toEqual([
    "waiting-audio",
    "waiting-audio",
    "waiting-audio",
  ]);
});
it("rejects duplicate owners before inference", () =>
  expect(() =>
    createScheduler(
      [segments[0], { ...segments[0], id: "other" }],
      lines,
      {} as any,
      {} as any,
      vi.fn(),
    ),
  ).toThrow());
it("preserves manual anchors and rejects invalid or crossing boundaries", () => {
  const manual = {
    ...lines[0],
    startMs: 100,
    endMs: 1000,
    status: "manual" as const,
  };
  expect(
    validateSegment([{ ...manual, status: "estimated" }], segments[0], [
      manual,
      ...lines.slice(1),
    ]).ok,
  ).toBe(false);
  expect(
    validateSegment([{ ...lines[0], excluded: true }], segments[0], lines).ok,
  ).toBe(false);
  expect(
    validateSegment([{ ...manual, startMs: 200 }], segments[0], [
      manual,
      ...lines.slice(1),
    ]).ok,
  ).toBe(false);
  expect(
    validateSegment([{ ...lines[0], startMs: 0, endMs: 0 }], segments[0], lines)
      .ok,
  ).toBe(false);
  expect(
    validateSegment(
      [{ ...lines[0], startMs: 500, endMs: 15000 }],
      segments[0],
      lines,
    ).ok,
  ).toBe(false);
  expect(
    validateSegment(
      [{ ...lines[0], startMs: 100, endMs: 1000 }],
      segments[0],
      lines,
    ).ok,
  ).toBe(true);
});
it("merges cumulative out-of-time-order segments and ignores stale jobs", () => {
  const initial = createSnapshot(key, lines, segments);
  const second = mergeSegment(
    initial,
    {
      key,
      segmentId: "s2",
      sequence: 1,
      lines: [{ ...lines[2], startMs: 21000, endMs: 22000 }],
    },
    segments,
  );
  const first = mergeSegment(
    second,
    {
      key,
      segmentId: "s0",
      sequence: 2,
      lines: [{ ...lines[0], startMs: 100, endMs: 1000 }],
    },
    segments,
  );
  expect(
    first.lines.filter((l) => l.startMs !== undefined).map((l) => l.id),
  ).toEqual(["l0", "l2"]);
  expect(
    mergeSegment(
      first,
      {
        key: { ...key, draftRevision: 0 },
        segmentId: "s1",
        sequence: 3,
        lines: [],
      },
      segments,
    ),
  ).toBe(first);
  expect(
    mergeSegment(
      first,
      { key, segmentId: "s1", sequence: 1, lines: [] },
      segments,
    ),
  ).toBe(first);
});
