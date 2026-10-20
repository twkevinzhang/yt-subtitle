import { expect, it } from "vitest";
import { normalizeSubtitle } from "../../src/lyrics/subtitle-source";
import { toSrt } from "../../src/lyrics/export";
const source = { kind: "paste" as const };
it("lrc_last_line_stays_pending", () => {
  const lines = normalizeSubtitle("[00:01.00]甲\n[00:03.00]乙", source, 10000);
  expect(lines.map((l) => [l.startMs, l.endMs])).toEqual([
    [1000, 3000],
    [3000, undefined],
  ]);
  expect(lines[0].timing.end).toMatchObject({ origin: "source", locked: true });
  expect(lines[1].status).toBe("unaligned");
});
it("srt_bom_crlf_multiline_roundtrip", () => {
  const lines = normalizeSubtitle(
    "\uFEFF1\r\n00:00:01,000 --> 00:00:03,000\r\nHello\r\n你好\r\n",
    source,
    10000,
  );
  expect(lines[0].original).toBe("Hello\n你好");
  expect(toSrt(lines, "original", 0, 10000)).toContain(
    "00:00:01,000 --> 00:00:03,000\nHello\n你好",
  );
});
it("overlap_is_not_retimed", () => {
  const lines = normalizeSubtitle(
    "1\n00:00:01,000 --> 00:00:04,000\n甲\n\n2\n00:00:02,000 --> 00:00:03,000\n乙",
    source,
    10000,
  );
  expect(lines.map((l) => [l.startMs, l.endMs])).toEqual([
    [1000, 4000],
    [2000, 3000],
  ]);
});
it("preserves plain text and rejects oversized input", () => {
  expect(
    normalizeSubtitle("甲\n(翻譯)\n乙", source, 10000).map((l) => l.original),
  ).toEqual(["甲", "(翻譯)", "乙"]);
  expect(() => normalizeSubtitle("甲".repeat(700000), source, 10000)).toThrow(
    /2 MiB/,
  );
  expect(() => normalizeSubtitle("a\n".repeat(10001), source, 10000)).toThrow(
    /10,000/,
  );
});
it("retains rejected timestamps for diagnosis without losing text", () => {
  const [line] = normalizeSubtitle(
    "1\n00:00:05,000 --> 00:00:03,000\n甲",
    source,
    10000,
  );
  expect(line.original).toBe("甲");
  expect(line.startMs).toBeUndefined();
  expect(line.timing.rejected).toEqual({ startMs: 5000, endMs: 3000 });
});
it("retains untimed rows in mixed LRC and warns on malformed timing", () => {
  const lines = normalizeSubtitle("[00:01.00]甲\n乙\n[00:xx]丙", source, 10000);
  expect(lines.map((l) => l.original)).toEqual(["甲", "乙", "丙"]);
  expect(lines[2].timing.warning).toBeTruthy();
});
it("keeps SRT text and whichever endpoint can be parsed", () => {
  const one = normalizeSubtitle(
    "1\n00:00:01,000 --> 00:xx:03,000\nkeep this text\nsecond row",
    { kind: "paste" },
    10000,
  );
  expect(one[0].original).toBe("keep this text\nsecond row");
  expect(one[0].startMs).toBe(1000);
  expect(one[0].endMs).toBeUndefined();
  expect(one[0].timing.warning).toContain("無法解析");
  const two = normalizeSubtitle(
    "1\ninvalid --> 00:00:03,000\nkeep end",
    { kind: "paste" },
    10000,
  );
  expect(two[0].startMs).toBeUndefined();
  expect(two[0].endMs).toBe(3000);
});
