import { expect, it, vi } from "vitest";
import { createScheduler } from "../../src/acoustic/scheduler";
import {
  validateSegment,
  AcousticBoundaryError,
} from "../../src/acoustic/validate-segment";
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
it("retries a rejected acoustic boundary once with a wider bounded window", async () => {
  const windows: any[] = [],
    publish = vi.fn(async () => {
      if (publish.mock.calls.length === 1)
        throw new AcousticBoundaryError("片段未通過邊界校驗");
    });
  const work = createScheduler(
    [segments[1]],
    lines,
    {
      availableRanges: () => [{ startMs: 0, endMs: 30000 }],
      read: async () => ({ pcm: new Float32Array(16), sampleRate: 16000 }),
      dispose() {},
    },
    {
      retain() {},
      release() {},
      cancel() {},
      align: async (input) => {
        windows.push(input.segment);
        return [];
      },
    },
    publish,
  );
  const states = await work.run(new AbortController().signal);
  expect(windows).toHaveLength(2);
  expect(windows[1].startMs).toBeLessThan(windows[0].startMs);
  expect(windows[1].contextLineIds).toEqual(["l0", "l2"]);
  expect(windows[1].endMs - windows[1].startMs).toBeLessThanOrEqual(30000);
  expect(states.s1).toBe("verified");
});
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
it("uses previously verified timings as context for the next segment", async () => {
  const observed: any[] = [];
  const work = createScheduler(
    segments.slice(0, 2),
    lines,
    {
      availableRanges: () => [{ startMs: 0, endMs: 30000 }],
      read: async () => ({ pcm: new Float32Array(16), sampleRate: 16000 }),
      dispose() {},
    },
    {
      retain() {},
      release() {},
      cancel() {},
      align: async (input) => {
        observed.push(input.lines.map((l) => ({ ...l })));
        return [
          {
            ...input.lines.find((l) => l.id === input.segment.lineIds[0])!,
            startMs: input.segment.id === "s0" ? 1000 : 11000,
            endMs: input.segment.id === "s0" ? 9000 : 19000,
          },
        ];
      },
    },
    async () => {},
  );
  await work.run(new AbortController().signal);
  expect(observed[1][0].startMs).toBe(1000);
  expect("startMs" in lines[0]).toBe(false);
});

it("recomputes the adjacent verified line together with a rejected boundary", async () => {
  const inputs: any[] = [];
  const commits: any[] = [];
  let rejected = false;
  const work = createScheduler(
    segments.slice(0, 2),
    lines,
    {
      availableRanges: () => [{ startMs: 0, endMs: 30000 }],
      read: async () => ({ pcm: new Float32Array(16), sampleRate: 16000 }),
      dispose() {},
    },
    {
      retain() {},
      release() {},
      cancel() {},
      align: async (input) => {
        inputs.push(input);
        return input.segment.lineIds.map((id) => ({
          ...input.lines.find((l) => l.id === id)!,
          startMs: id === "l0" ? 1000 : 10000,
          endMs: id === "l0" ? 10000 : 19000,
        }));
      },
    },
    async (segment, result, context) => {
      if (segment.id === "s1" && !rejected) {
        rejected = true;
        throw new AcousticBoundaryError("cross");
      }
      commits.push({ segment, result, context });
    },
  );
  await work.run(new AbortController().signal);
  expect(inputs.at(-1).segment.lineIds).toEqual(["l0", "l1"]);
  expect(commits.at(-1).result.map((l: any) => l.id)).toEqual(["l1"]);
  expect(commits.at(-1).context.map((l: any) => l.id)).toEqual(["l0"]);
});
it("does not start inference if cancelled while reading PCM", async () => {
  const controller = new AbortController();
  const align = vi.fn(async () => []);
  const work = createScheduler(
    [segments[0]],
    lines,
    {
      availableRanges: () => [{ startMs: 0, endMs: 30000 }],
      read: async () => {
        controller.abort();
        return { pcm: new Float32Array(16), sampleRate: 16000 };
      },
      dispose() {},
    },
    { retain() {}, release() {}, cancel() {}, align },
    async () => {},
  );
  await work.run(controller.signal);
  expect(align).not.toHaveBeenCalled();
});
it("can jointly repair within a full thirty-second window", async () => {
  const source: any[] = [
    { ...lines[0], startMs: 5000, endMs: 10000 },
    lines[1],
    { ...lines[2], startMs: 30000, endMs: 35000 },
  ];
  const inputs: any[] = [];
  let count = 0;
  const work = createScheduler(
    [{ ...segments[1], startMs: 10000, endMs: 30000 }],
    source,
    {
      availableRanges: () => [{ startMs: 0, endMs: 40000 }],
      read: async () => ({ pcm: new Float32Array(16), sampleRate: 16000 }),
      dispose() {},
    },
    {
      retain() {},
      release() {},
      cancel() {},
      align: async (i) => {
        inputs.push(i);
        return [];
      },
    },
    async () => {
      if (++count === 1) throw new AcousticBoundaryError("cross");
    },
  );
  await work.run(new AbortController().signal);
  expect(inputs).toHaveLength(2);
  expect(inputs[1].segment.lineIds).toContain("l0");
});
