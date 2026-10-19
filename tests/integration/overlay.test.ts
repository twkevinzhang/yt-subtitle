import { it, expect } from "vitest";
import { activeLines } from "../../src/content/overlay";
it("uses actual media time, hides excluded rows and handles offset", () => {
  const l = {
    id: "a",
    original: "song",
    startMs: 1000,
    endMs: 2000,
    cueIds: [],
    status: "manual" as const,
    excluded: false,
  };
  expect(activeLines([l], 1500, 0)).toHaveLength(1);
  expect(activeLines([l], 900, 0)).toHaveLength(0);
  expect(activeLines([{ ...l, excluded: true }], 1500, 0)).toHaveLength(0);
  expect(activeLines([l], 2050, 100)).toHaveLength(1);
});
