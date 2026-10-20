import { it, expect } from "vitest";
import { selectManualTrack } from "../../src/youtube/manual-tracks";
const track = (
  id: string,
  language: string,
  isAuto = false,
  isTranslated = false,
) => ({
  schemaVersion: 1 as const,
  id,
  language,
  isAuto,
  isTranslated,
  label: language,
  url: "https://www.youtube.com/api/timedtext",
});
it("prefers selected manual, then exact language, primary language, then list order", () => {
  const tracks = [
    track("j", "ja"),
    track("z", "zh-CN"),
    track("t", "zh-Hant"),
    track("a", "zh-Hant", true),
  ];
  expect(selectManualTrack(tracks, "j", "zh-Hant")?.id).toBe("j");
  expect(selectManualTrack(tracks, "a", "zh-Hant")?.id).toBe("t");
  expect(selectManualTrack(tracks, undefined, "zh-TW")?.id).toBe("z");
  expect(selectManualTrack(tracks, undefined, "en")?.id).toBe("j");
  expect(
    selectManualTrack(
      [track("a", "en", true), track("t", "en", false, true)],
      undefined,
      "en",
    ),
  ).toBeUndefined();
});
