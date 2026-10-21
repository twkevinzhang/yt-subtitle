import { expect, it } from "vitest";
import { acousticGapSegments } from "../../src/acoustic/acoustic-gaps";
import { normalizeSubtitle } from "../../src/lyrics/subtitle-source";
it("requires an independently timed neighbor and bounds candidate audio without dividing it among lines", () => {
  const lines = normalizeSubtitle("a\nb\nc", { kind: "paste" }, 80000);
  expect(acousticGapSegments(lines, 80000)).toEqual([]);
  Object.assign(lines[0], { startMs: 1000, endMs: 5000 });
  const original = structuredClone(lines);
  expect(acousticGapSegments(lines, 80000)).toMatchObject([
    { startMs: 5000, endMs: 35000, lineIds: ["l1", "l2"] },
  ]);
  expect(lines).toEqual(original);
});
it("skips explicitly excluded originals and never crosses the next existing start", () => {
  const lines = normalizeSubtitle(
    "before\nunsung title\nsung line\nafter",
    { kind: "paste" },
    10000,
  );
  Object.assign(lines[0], { startMs: 0, endMs: 2000 });
  lines[1].excluded = true;
  Object.assign(lines[3], { startMs: 6000, endMs: 10000 });
  expect(acousticGapSegments(lines, 10000)).toMatchObject([
    { startMs: 2000, endMs: 6000, lineIds: ["l2"] },
  ]);
});
