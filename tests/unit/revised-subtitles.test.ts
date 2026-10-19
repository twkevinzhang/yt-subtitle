import { expect, it } from "vitest";
import {
  parseRevisedSubtitles,
  revisedSubtitleRequest,
  missingTimingPlan,
  mergeMissingTimes,
} from "../../src/lyrics/revised-subtitles";
it("uses AI text, line breaks and new row count without any input ID mapping", () => {
  const result = parseRevisedSubtitles(
    {
      lines: [
        { id: "new", text: "新版\n第二行", startMs: 120, endMs: 900 },
        { id: "new", text: "追加", startMs: 500, endMs: 1000 },
      ],
    },
    2000,
  );
  expect(result.map((l) => l.original)).toEqual(["新版\n第二行", "追加"]);
  expect(new Set(result.map((l) => l.id)).size).toBe(2);
  expect(result.map((l) => [l.startMs, l.endMs])).toEqual([
    [120, 900],
    [500, 1000],
  ]);
});
it("keeps missing times missing and rejects malformed supplied times", () => {
  expect(
    parseRevisedSubtitles(
      { lines: [{ text: "pending", startMs: null, endMs: null }] },
      2000,
    )[0].startMs,
  ).toBeUndefined();
  expect(() =>
    parseRevisedSubtitles(
      { lines: [{ text: "bad", startMs: 900, endMs: 100 }] },
      2000,
    ),
  ).toThrow();
  expect(() =>
    parseRevisedSubtitles(
      { lines: [{ text: "bad", startMs: -1, endMs: 100 }] },
      2000,
    ),
  ).toThrow();
});
it("asks for a revised complete subtitle list instead of fixed input IDs", () => {
  const text = revisedSubtitleRequest("m", [], []).messages[0].content;
  expect(text).toContain("新版字幕");
  expect(text).toContain("不得平均");
  expect(text).toContain("不必保留輸入行數或 ID");
  expect(text).toContain("既有時間軸為基礎");
  expect(text).toContain("能沿用或合併");
});
it("sends only incomplete AI rows to WASM and preserves every supplied timestamp on merge", () => {
  const rows = parseRevisedSubtitles(
    {
      lines: [
        { text: "AI complete", startMs: 100, endMs: 600 },
        { text: "missing end", startMs: 800, cueIds: ["c"] },
        { text: "AI other", startMs: 1600, endMs: 1900 },
      ],
    },
    2000,
  );
  const plan = missingTimingPlan(
    rows,
    [{ id: "c", text: "missing", startMs: 700, endMs: 1500 }],
    2000,
  );
  expect(plan.lines.map((l) => l.original)).toEqual(["missing end"]);
  const merged = mergeMissingTimes(rows, [
    { ...plan.lines[0], original: "must not win", startMs: 750, endMs: 1400 },
  ]);
  expect(merged.map((l) => l.original)).toEqual(rows.map((l) => l.original));
  expect(merged[1].startMs).toBe(800);
  expect(merged[1].endMs).toBe(1400);
  expect(merged[0]).toEqual(rows[0]);
});
it("keeps complete AI timestamps as search bounds without sending those rows for inference", () => {
  const rows = parseRevisedSubtitles(
    {
      lines: [
        { text: "anchor", startMs: 240000, endMs: 250000 },
        { text: "tail" },
      ],
    },
    300000,
  );
  const plan = missingTimingPlan(rows, [], 300000);
  expect(plan.lines).toHaveLength(1);
  expect(plan.bounds[rows[1].id]).toEqual({ startMs: 250000, endMs: 300000 });
});
it("accepts an empty AI subtitle version without restoring input rows", () => {
  expect(parseRevisedSubtitles({ lines: [] }, 2000)).toEqual([]);
});
