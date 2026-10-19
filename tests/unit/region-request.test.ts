import { expect, it } from "vitest";
import {
  parseRegions,
  parseRegionPlan,
  regionRequest,
} from "../../src/lyrics/region-request";
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
  expect(body.messages[1].content).not.toContain('"cueIds"');
  expect(body.messages[0].content).toContain("不可重用");
});
it("accepts coarse transcript context within three seconds but rejects remote evidence", () => {
  const segment = {
    id: "s",
    lineIds: ["l1"],
    contextLineIds: [],
    startMs: 3500,
    endMs: 20500,
    language: "en",
    evidenceCueIds: ["c2"],
    occurrence: 1,
  };
  expect(
    parseRegions(
      { segments: [segment] },
      lines,
      [{ id: "c2", startMs: 23000, endMs: 27000, text: "next context" }],
      30000,
    ),
  ).toHaveLength(1);
  expect(() =>
    parseRegions(
      { segments: [segment] },
      lines,
      [{ id: "c2", startMs: 25000, endMs: 27000, text: "remote" }],
      30000,
    ),
  ).toThrow();
});
it("attaches an explicit adjacent companion without treating it as sung text", () => {
  const source = [
    lines[0],
    { ...lines[0], id: "l2", original: "（你還沉迷其中）" },
  ];
  const plan = parseRegionPlan(
    { segments: [], companions: [{ lineId: "l2", parentLineId: "l1" }] },
    source,
    cues,
    30000,
  );
  expect(plan.lines).toHaveLength(1);
  expect(plan.lines[0].original).toBe("repeat\n（你還沉迷其中）");
  expect(plan.lines[0].alignmentText).toBe("repeat");
  expect(source[0].original).toBe("repeat");
  expect(() =>
    parseRegionPlan(
      { segments: [], companions: [{ lineId: "l1", parentLineId: "l2" }] },
      source,
      cues,
      30000,
    ),
  ).toThrow();
});
it("rejects reversed occurrences and keeps unmatched lyrics pending instead of distributing them", () => {
  const source = [lines[0], { ...lines[0], id: "l2" }];
  const segment = {
    id: "s1",
    lineIds: ["l1"],
    contextLineIds: [],
    startMs: 10000,
    endMs: 15000,
    language: "en",
    evidenceCueIds: ["c1"],
    occurrence: 1,
  };
  expect(() =>
    parseRegions(
      {
        segments: [
          segment,
          {
            ...segment,
            id: "s2",
            lineIds: ["l2"],
            startMs: 5000,
            endMs: 12000,
          },
        ],
      },
      source,
      cues,
      30000,
    ),
  ).toThrow();
  const plan = parseRegionPlan(
    { segments: [segment], companions: [] },
    source,
    cues,
    30000,
  );
  expect(plan.lines[1].startMs).toBeUndefined();
  expect(plan.segments).toHaveLength(1);
});
