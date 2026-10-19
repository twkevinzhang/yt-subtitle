import { it, expect } from "vitest";
import { parseYouTubeCaptions } from "../../src/youtube/captions";
it("reads JSON3 segments with milliseconds", () =>
  expect(
    parseYouTubeCaptions(
      JSON.stringify({
        events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "歌" }] }],
      }),
      "json3",
    ),
  ).toEqual([{ id: "c0", startMs: 1000, endMs: 3000, text: "歌" }]));
it("preserves repeated text at different times", () =>
  expect(
    parseYouTubeCaptions(
      '<timedtext><body><p t="1000" d="1000">chorus</p><p t="3000" d="1000">chorus</p></body></timedtext>',
      "srv3",
    ),
  ).toHaveLength(2));
it("does not accept a discovered track with no cues", () =>
  expect(() => parseYouTubeCaptions("{}", "json3")).toThrow());
it("explains empty server replies without exposing JSON parser internals", () =>
  expect(() => parseYouTubeCaptions("", "json3")).toThrow("字幕"));
