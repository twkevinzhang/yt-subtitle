import { it, expect } from "vitest";
import { toSrt, safeFilename } from "../../src/lyrics/export";
import type { AlignedLine } from "../../src/shared/types";
const line: AlignedLine = {
  id: "a",
  original: "original",
  translation: "翻譯",
  cueIds: [],
  status: "manual",
  excluded: false,
  startMs: 1000,
  endMs: 2000,
};
it("exports bilingual text with actual offset", () =>
  expect(toSrt([line], "bilingual", 100, 5000)).toBe(
    "1\n00:00:01,100 --> 00:00:02,100\noriginal\n翻譯\n",
  ));
it("blocks unaligned and missing translation but permits exclusions", () => {
  expect(() =>
    toSrt(
      [{ ...line, status: "unaligned", startMs: undefined }],
      "original",
      0,
      5000,
    ),
  ).toThrow();
  expect(() =>
    toSrt([{ ...line, translation: undefined }], "translation", 0, 5000),
  ).toThrow();
  expect(toSrt([{ ...line, excluded: true }], "original", 0, 5000)).toBe("");
});
it("sanitizes filenames", () => expect(safeFilename("a/b:c?")).toBe("a_b_c_"));
