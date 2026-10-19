import { it, expect } from "vitest";
import { validateAlignment } from "../../src/lyrics/alignment";
import { makeBatches, prepareAlignmentRetry } from "../../src/lyrics/batches";
const lines = [
  {
    id: "l0",
    original: "歌",
    cueIds: [],
    status: "unaligned" as const,
    excluded: false,
  },
];
const cues = [{ id: "c0", startMs: 1000, endMs: 2000, text: "歌" }];
it("keeps valid subdivisions inside one shared transcript cue", () => {
  const pair = [lines[0], { ...lines[0], id: "l1" }];
  const result = validateAlignment(
    {
      lines: [
        {
          id: "l0",
          cueIds: ["t0"],
          status: "estimated",
          startMs: 1000,
          endMs: 4000,
        },
        {
          id: "l1",
          cueIds: ["t0"],
          status: "estimated",
          startMs: 4000,
          endMs: 8000,
        },
      ],
    },
    pair,
    [{ id: "t0", startMs: 0, endMs: 10000, text: "兩句歌詞" }],
    10000,
  );
  expect(result.map((l) => l.startMs)).toEqual([1000, 4000]);
});
it("isolates a late outlier instead of deleting the following valid sequence", () => {
  const rows = [274000, 23000, 28000, 35000];
  const result = validateAlignment(
    {
      lines: rows.map((_, i) => ({
        id: `l${i}`,
        cueIds: [`t${i}`],
        status: "anchor",
      })),
    },
    rows.map((_, i) => ({ ...lines[0], id: `l${i}` })),
    rows.map((startMs, i) => ({
      id: `t${i}`,
      startMs,
      endMs: startMs + 1000,
      text: "歌",
    })),
    300000,
  );
  expect(result.map((l) => l.startMs)).toEqual([
    undefined,
    23000,
    28000,
    35000,
  ]);
});
it("does not label transcript boundary estimates as exact anchors", () => {
  expect(
    validateAlignment(
      { lines: [{ id: "l0", cueIds: ["c0"], status: "anchor" }] },
      lines,
      [{ ...cues[0], endEstimated: true }],
      5000,
    )[0].status,
  ).toBe("estimated");
});
it("derives anchor time from actual cue IDs not invented model times", () => {
  const out = validateAlignment(
    {
      lines: [
        { id: "l0", cueIds: ["c0"], status: "anchor", startMs: 5, endMs: 99 },
      ],
    },
    lines,
    cues,
    5000,
  );
  expect(out[0].startMs).toBe(1000);
});
it("keeps no-anchor lines unaligned and rejects missing rows", () => {
  expect(
    validateAlignment(
      { lines: [{ id: "l0", cueIds: ["fake"], status: "anchor" }] },
      lines,
      cues,
      5000,
    )[0].status,
  ).toBe("unaligned");
  expect(() => validateAlignment({ lines: [] }, lines, cues, 5000)).toThrow();
});
it("preserves translation original and manual timing", () => {
  const out = validateAlignment(
    {
      lines: [
        { id: "l0", original: "invented", translation: "song", cueIds: [] },
      ],
    },
    [{ ...lines[0], status: "manual", startMs: 100, endMs: 900 }],
    cues,
    5000,
  );
  expect(out[0]).toMatchObject({
    original: "歌",
    startMs: 100,
    endMs: 900,
    translation: "song",
  });
});
it("keeps global IDs and final batch in 81 lines", () => {
  const out = makeBatches(
    Array.from({ length: 81 }, (_, i) => ({ ...lines[0], id: `l${i}` })),
    cues,
  );
  expect(out.map((b) => b.lines.length)).toEqual([40, 40, 1]);
  expect(out[2].lines[0].id).toBe("l80");
  expect(out[0].context?.at(-1)?.id).toBe("l80");
});
it("retries AI timing without freezing a bad old anchor or changing manual times", () => {
  const result = prepareAlignmentRetry([
    lines[0],
    {
      ...lines[0],
      id: "l1",
      status: "estimated",
      startMs: 274000,
      endMs: 280000,
    },
    { ...lines[0], id: "l2", status: "manual", startMs: 1000, endMs: 2000 },
  ]);
  expect(result[1].startMs).toBeUndefined();
  expect(result[2].startMs).toBe(1000);
});
it("reports rejected cue references and keeps the proposed times for diagnosis", () => {
  const decisions: any[] = [];
  validateAlignment(
    {
      lines: [
        {
          id: "l0",
          cueIds: ["bad"],
          status: "estimated",
          startMs: 1000,
          endMs: 2000,
        },
      ],
    },
    lines,
    cues,
    5000,
    decisions,
  );
  expect(decisions[0]).toMatchObject({
    accepted: false,
    reason: "AI 引用了不存在的字幕 ID",
    proposedStartMs: 1000,
  });
});
it("protects manual anchors when choosing the global sequence", () => {
  const decisions: any[] = [];
  const out = validateAlignment(
    {
      lines: [
        { id: "l0", cueIds: ["c0"], status: "anchor" },
        { id: "l1", cueIds: [], status: "unaligned" },
      ],
    },
    [
      lines[0],
      { ...lines[0], id: "l1", status: "manual", startMs: 500, endMs: 1000 },
    ],
    cues,
    5000,
    decisions,
  );
  expect(out.map((line) => line.startMs)).toEqual([undefined, 500]);
});
