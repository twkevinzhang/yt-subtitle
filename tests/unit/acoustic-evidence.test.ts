import { expect, it } from "vitest";
import {
  tokenLogProbability,
  supportsAcousticText,
} from "../../src/acoustic/acoustic-evidence";
it("compares the supplied token with the complete vocabulary using stable log probabilities", () => {
  expect(
    tokenLogProbability(new Float32Array([1000, 1001, 999]), 0, 3, 1),
  ).toBeCloseTo(-0.407606, 5);
  expect(() => tokenLogProbability(new Float32Array([1]), 0, 3, 1)).toThrow();
});
it("requires real audio to explain the text substantially better than the same forced text over silence", () => {
  expect(supportsAcousticText(-2.81, -4)).toBe(true);
  expect(supportsAcousticText(-4.11, -6.07)).toBe(true);
  expect(supportsAcousticText(-5.91, -5.99)).toBe(false);
  expect(supportsAcousticText(-3.51, -3.57)).toBe(false);
  expect(supportsAcousticText(-2, -2.8)).toBe(false);
  expect(supportsAcousticText(-4.08, -3.76)).toBe(false);
  expect(supportsAcousticText(NaN, -4)).toBe(false);
  expect(supportsAcousticText(-2, -Infinity)).toBe(false);
});
