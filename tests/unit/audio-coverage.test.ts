import { expect, it } from "vitest";
import { AudioCoverage } from "../../src/acoustic/audio-coverage";

it("does not mistake the last downloaded range for complete audio", () => {
  const coverage = new AudioCoverage();
  coverage.add([
    [0, 20],
    [280, 300],
  ]);
  expect(coverage.complete(300)).toBe(false);
  coverage.add([[19.98, 150]]);
  coverage.add([[149.99, 280]]);
  expect(coverage.complete(300)).toBe(true);
});
it("retains earlier coverage after SourceBuffer eviction and rejects bad ranges", () => {
  const coverage = new AudioCoverage();
  coverage.add([[0, 60]]);
  coverage.add([[60, 120]]);
  expect(coverage.complete(120)).toBe(true);
  expect(() => coverage.add([[120, Infinity]])).toThrow();
  expect(() => coverage.add([[130, 120]])).toThrow();
  expect(coverage.complete(0)).toBe(false);
});
