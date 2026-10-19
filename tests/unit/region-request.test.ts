import { expect, it } from "vitest";
import { parseRegions, regionRequest } from "../../src/lyrics/region-request";
const lines = [
  {
    id: "l1",
    original: "repeat",
    cueIds: [],
    excluded: false,
    status: "unaligned" as const,
  },
];
const cues = [{ id: "c1", startMs: 10000, endMs: 20000, text: "repeat" }];
it("rejects legacy line timestamps as a region map", () =>
  expect(() => parseRegions({ lines: [] }, lines, cues, 30000)).toThrow());
it("requires actual caption evidence and valid ownership", () => {
  const segment = {
    id: "s1",
    lineIds: ["l1"],
    contextLineIds: [],
    startMs: 9000,
    endMs: 21000,
    language: "en",
    evidenceCueIds: ["c1"],
    occurrence: 2,
  };
  expect(parseRegions({ segments: [segment] }, lines, cues, 30000)).toEqual([
    segment,
  ]);
  expect(() =>
    parseRegions(
      { segments: [{ ...segment, evidenceCueIds: ["invented"] }] },
      lines,
      cues,
      30000,
    ),
  ).toThrow();
  expect(() =>
    parseRegions(
      { segments: [segment, { ...segment, id: "duplicate" }] },
      lines,
      cues,
      30000,
    ),
  ).toThrow();
});
it("builds region prompts without final per-line times", () => {
  const body = regionRequest("model", lines, cues);
  expect(body.model).toBe("model");
  expect(body.messages[0].content).toContain("重複");
  expect(body.messages[1].content).toContain("l1");
  expect(body.stream).toBe(false);
});
