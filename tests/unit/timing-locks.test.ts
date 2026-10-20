import { expect, it } from "vitest";
import { lockTiming, mergeTiming } from "../../src/lyrics/timing-locks";
const line = {
  id: "l",
  original: "歌",
  cueIds: [],
  status: "unaligned" as const,
  excluded: false,
};
it("preserves_partial_endpoint", () => {
  const source = lockTiming({ ...line, startMs: 1000 }, 10000);
  const filled = mergeTiming(source, { startMs: 1200, endMs: 3000 }, 10000);
  expect([filled.startMs, filled.endMs, filled.original]).toEqual([
    1000,
    3000,
    "歌",
  ]);
  expect(filled.timing.end?.origin).toBe("model");
  expect(source.endMs).toBeUndefined();
});
it("preserves all existing endpoints including unaligned legacy status", () => {
  const source = lockTiming({ ...line, startMs: 1000, endMs: 4000 }, 10000);
  expect(mergeTiming(source, { startMs: 2000, endMs: 3000 }, 10000)).toEqual(
    source,
  );
});
it("does not merge an invalid inferred end or overwrite manual time", () => {
  const source = lockTiming(
    { ...line, status: "manual", startMs: 1000 },
    10000,
  );
  expect(mergeTiming(source, { endMs: 500 }, 10000).endMs).toBeUndefined();
  expect(mergeTiming(source, { endMs: 10001 }, 10000).endMs).toBeUndefined();
  expect(source.timing.start?.origin).toBe("manual");
});
