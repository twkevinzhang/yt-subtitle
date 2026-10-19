import { it, expect } from "vitest";
import { validateAlignment } from "../../src/lyrics/alignment";
import { makeBatches } from "../../src/lyrics/batches";
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
});
