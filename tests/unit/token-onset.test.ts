import { expect, it } from "vitest";
import { refineTokenOnset } from "../../src/acoustic/token-onset";
it("uses acoustic attention to avoid assigning leading silence to a first token", () => {
  const row = new Float32Array(100).fill(0.001);
  for (let i = 40; i < 50; i++) row[i] = 1;
  expect(refineTokenOnset([row, row], 0, 1200)).toBe(800);
});
it("keeps flat or invalid attention unchanged and never crosses the token end", () => {
  expect(refineTokenOnset([new Float32Array(100).fill(1)], 100, 1000)).toBe(
    100,
  );
  expect(refineTokenOnset([], 100, 1000)).toBe(100);
  const row = new Float32Array(100);
  row[40] = 1;
  expect(refineTokenOnset([row], 100, 500)).toBe(100);
});
