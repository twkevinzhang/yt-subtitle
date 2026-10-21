import { it, expect } from "vitest";
import { createAlignmentPolicy } from "../../src/acoustic/alignment-policy";
it("uses 15/30s targets and 3s low water with 26s windows clipped at the end", () => {
  const p = createAlignmentPolicy("buffer-before-play", 50000);
  expect(p.target(10000, true)).toEqual({ startMs: 10000, endMs: 25000 });
  expect(p.target(40000, false).endMs).toBe(50000);
  expect(p.needsBuffer(10000, [{ startMs: 0, endMs: 14000 }])).toBe(false);
  expect(p.nextRanges(30000, [])[0].startMs).toBe(24000);
  expect(p.nextRanges(0, []).every((r) => r.endMs - r.startMs <= 26000)).toBe(
    true,
  );
});
it("processes the current position and ahead first, then scans older windows forward with one rewind", () => {
  const p = createAlignmentPolicy("buffer-before-play", 299961);
  expect(p.nextRanges(289940, []).map((r) => r.startMs)).toEqual([
    288000, 0, 24000, 48000, 72000, 96000, 120000, 144000,
    168000, 192000, 216000, 240000, 264000,
  ]);
  const background = createAlignmentPolicy("background", 150000);
  expect(background.nextRanges(75000, []).map((r) => r.startMs)).toEqual([
    72000, 96000, 120000, 144000, 0, 24000, 48000,
  ]);
});
