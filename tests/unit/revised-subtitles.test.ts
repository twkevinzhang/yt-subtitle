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
  expect(text).toContain("整首逐句字幕");
  expect(text).toContain("估計時間不是聲學確認");
  expect(text).toContain("不必保留輸入行數或 ID");
  expect(text).toContain("完整 YT 字幕是輸出底稿");
  expect(text).toContain("能沿用或合併");
});
it("requires sentence cues even when one YouTube cue contains several sung lines", () => {
  const text = revisedSubtitleRequest("m", [], []).messages[0].content;
  expect(text).toContain("每個 lines 項目只包含一句唱詞");
  expect(text).toContain("不得把數句唱詞合併成一項");
  expect(text).toContain("一個 cue 拆成多句不能複製整段起迄");
  expect(text).toContain("各句時間無法可靠細分時，仍逐句回傳");
  expect(text).not.toContain("可保留為合適的一個新 cue");
});
it("uses the whole YouTube transcript as the base even when supplied lyrics omit a later verse", () => {
  const body = revisedSubtitleRequest(
    "m",
    [
      {
        id: "l0",
        original: "使用者修正前段",
        cueIds: [],
        status: "unaligned",
        excluded: false,
      },
    ],
    [
      { id: "c0", text: "前段辨識文字", startMs: 0, endMs: 3000 },
      {
        id: "c1",
        text: "振り返れば去年みたい。無邪気だった少年時代。",
        startMs: 164000,
        endMs: 168000,
      },
    ],
  );
  const system = body.messages[0].content;
  expect(system).toContain("完整 YT 字幕是輸出底稿");
  expect(system).toContain("使用者歌詞只取代有合理對應的部分");
  expect(system).toContain("沒有使用者歌詞對應的 YT 唱詞仍須保留");
  expect(system).toContain("不得因使用者未貼出後半段而截斷輸出");
  expect(system).toContain("不能只遍歷使用者歌詞");
  const input = JSON.parse(body.messages[1].content);
  expect(input.cues[1].startMs).toBe(164000);
  expect(input.cues[1].text).toContain("少年時代");
});
it("requests playable estimated times and constrains repeated lyrics with surrounding anchors", () => {
  const system = revisedSubtitleRequest("m", [], []).messages[0].content;
  expect(system).toContain("每一句都提供可播放的數值 startMs/endMs");
  expect(system).toContain("estimated:true");
  expect(system).not.toContain("這些句子的 startMs 與 endMs 全部填 null");
  expect(system).toContain("候選 cue 必須位於前後錨點之間");
});
it("preserves AI estimated timing as estimated instead of an acoustic confirmation", () => {
  expect(
    parseRevisedSubtitles(
      {
        lines: [
          { text: "approximate", startMs: 100, endMs: 900, estimated: true },
        ],
      },
      1000,
    )[0].status,
  ).toBe("estimated");
});
it("keeps explicitly estimated shared times usable instead of blocking the complete subtitle", () => {
  const rows = parseRevisedSubtitles(
    {
      lines: [
        { text: "first", startMs: 1000, endMs: 4000, estimated: true },
        { text: "second", startMs: 1000, endMs: 4000, estimated: true },
      ],
    },
    5000,
  );
  expect(
    rows.every(
      (l) => l.status === "estimated" && l.startMs === 1000 && l.endMs === 4000,
    ),
  ).toBe(true);
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
it("treats shared broad AI times as coarse hints and jointly aligns the separate sentences", () => {
  const texts = [
    "鼻につく 革靴",
    "治ればまた 靴擦れ",
    "ネオンが照らす街流す 本日も",
    "ドライバーいるから 安定の無事故",
  ];
  const rows = parseRevisedSubtitles(
    {
      lines: texts.map((text) => ({
        text,
        startMs: 40000,
        endMs: 48000,
        cueIds: ["t7"],
      })),
    },
    300000,
  );
  expect(rows.map((l) => l.original)).toEqual(texts);
  expect(
    rows.every((l) => l.startMs === undefined && l.endMs === undefined),
  ).toBe(true);
  const plan = missingTimingPlan(
    rows,
    [{ id: "t7", text: "coarse", startMs: 40000, endMs: 48000 }],
    300000,
  );
  expect(plan.segments).toHaveLength(1);
  expect(plan.segments[0]).toMatchObject({
    startMs: 40000,
    endMs: 48000,
    lineIds: rows.map((l) => l.id),
  });
  expect(plan.bounds[rows[0].id]).toEqual({ startMs: 40000, endMs: 48000 });
  const inferred = rows.map((l, i) => ({
    ...l,
    startMs: 40000 + i * 2000,
    endMs: 42000 + i * 2000,
  }));
  expect(
    mergeMissingTimes(rows, inferred).map((l) => [l.startMs, l.endMs]),
  ).toEqual([
    [40000, 42000],
    [42000, 44000],
    [44000, 46000],
    [46000, 48000],
  ]);
});
it("detects slightly different broad overlapping intervals but preserves explicitly simultaneous singing", () => {
  const sequential = parseRevisedSubtitles(
    {
      lines: [
        { text: "one", startMs: 1000, endMs: 10000 },
        { text: "two", startMs: 1200, endMs: 9800 },
      ],
    },
    20000,
  );
  expect(sequential.every((l) => l.startMs === undefined)).toBe(true);
  const harmony = parseRevisedSubtitles(
    {
      lines: [
        { text: "lead", startMs: 1000, endMs: 10000, simultaneous: true },
        { text: "harmony", startMs: 1000, endMs: 10000, simultaneous: true },
      ],
    },
    20000,
  );
  expect(harmony.every((l) => l.startMs === 1000 && l.endMs === 10000)).toBe(
    true,
  );
});
it("finds broad near-duplicate windows even with a shorter interval between them", () => {
  const rows = parseRevisedSubtitles(
    {
      lines: [
        { text: "a", startMs: 0, endMs: 10000 },
        { text: "short", startMs: 100, endMs: 4100 },
        { text: "c", startMs: 200, endMs: 10200 },
      ],
    },
    20000,
  );
  expect(rows[0].startMs).toBeUndefined();
  expect(rows[2].startMs).toBeUndefined();
  expect(rows[1].startMs).toBe(100);
});
it("jointly refines a suspicious group even when each row references a different coarse cue", () => {
  const rows = parseRevisedSubtitles(
    {
      lines: [
        { text: "first", startMs: 1000, endMs: 10000, cueIds: ["a"] },
        { text: "second", startMs: 1200, endMs: 9800, cueIds: ["b"] },
      ],
    },
    20000,
  );
  const plan = missingTimingPlan(
    rows,
    [
      { id: "a", text: "coarse a", startMs: 1000, endMs: 10000 },
      { id: "b", text: "coarse b", startMs: 1200, endMs: 9800 },
    ],
    20000,
  );
  expect(plan.segments).toHaveLength(1);
  expect(plan.segments[0].lineIds).toEqual(rows.map((l) => l.id));
  expect(plan.segments[0].evidenceCueIds).toEqual(["a", "b"]);
});
