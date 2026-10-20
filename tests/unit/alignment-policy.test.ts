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
