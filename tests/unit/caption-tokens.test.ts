import { expect, it } from "vitest";
import { parseYouTubeCaptions } from "../../src/youtube/captions";
it("retains ASR token start offsets without inventing token end times", () => {
  const [cue] = parseYouTubeCaptions(
    JSON.stringify({
      events: [
        {
          tStartMs: 1000,
          dDurationMs: 3000,
          segs: [
            { utf8: "first", tOffsetMs: 0 },
            { utf8: " second", tOffsetMs: 450 },
          ],
        },
      ],
    }),
    "json3",
  );
  expect(cue.tokens).toEqual([
    { text: "first", startMs: 1000 },
    { text: " second", startMs: 1450 },
  ]);
});
