import fixture from "../fixtures/reported-song-request.json";
import { expect, it } from "vitest";
import {
  parseRevisedSubtitles,
  missingTimingPlan,
  mergeMissingTimes,
} from "../../src/lyrics/revised-subtitles";
import { activeLines } from "../../src/content/overlay";
import { validateMessage } from "../../src/shared/schemas";

it("replays the supplied 78-line / 44-cue request without a browser or live AI call", () => {
  const { lyrics, cues } = fixture.data;
  expect(fixture.model).toBe("gpt-6-luna");
  expect(lyrics).toHaveLength(78);
  expect(cues).toHaveLength(44);
  // A deliberately bad AI reply reproduces the two wide-time groups visible
  // in the screenshots. This is not claimed to be the user's unseen raw reply.
  const reply = {
    lines: lyrics.map((l: { text: string }, i: number) => ({
      text: l.text,
      startMs: i < 8 ? 4000 : i >= 64 && i <= 73 ? 151000 : null,
      endMs: i < 8 ? 20000 : i >= 64 && i <= 73 ? 164000 : null,
      cueIds: i < 8 ? ["t1"] : i >= 64 && i <= 73 ? ["t22"] : [],
    })),
  };
  const raw = JSON.stringify(reply);
  const parsed = parseRevisedSubtitles(JSON.parse(raw), 299961);
  expect(parsed.map((l) => l.original)).toEqual(
    lyrics.map((l: { text: string }) => l.text),
  );
  expect(activeLines(parsed, 10000, 0)).toHaveLength(0);
  expect(activeLines(parsed, 155000, 0)).toHaveLength(0);
  expect(
    parsed.every((l) => l.startMs === undefined && l.endMs === undefined),
  ).toBe(true);
  const message = validateMessage({
    type: "generate",
    input: {
      video: {
        schemaVersion: 1,
        videoId: "e1ZMmRlsaaU",
        title: "song",
        channel: "",
        description: "",
        durationMs: 299961,
      },
      lines: parsed,
      cues,
      targetLanguage: "ja",
      translate: false,
      timingOnly: true,
      audioAssetId: "asset",
      consent: {
        purpose: "generate",
        inputHash: "hash",
        confirmedAt: Date.now(),
        settingsRevision: 1,
      },
    },
  }) as any;
  const plan = missingTimingPlan(message.input.lines, cues, 299961);
  expect(plan.bounds["ai-0"]).toEqual({ startMs: 4000, endMs: 20000 });
  expect(plan.bounds["ai-64"]).toEqual({ startMs: 151000, endMs: 164000 });
  // Controlled host outputs exercise merge/overlay, not acoustic accuracy.
  const timed = parsed
    .slice(64, 74)
    .map((l, i) => ({
      ...l,
      startMs: 151000 + i * 1000,
      endMs: 151800 + i * 1000,
    }));
  const merged = mergeMissingTimes(parsed, timed);
  expect(activeLines(merged, 155100, 0).map((l) => l.id)).toEqual(["ai-68"]);
  expect(merged.map((l) => l.original)).toEqual(parsed.map((l) => l.original));
  expect(JSON.stringify(reply)).toBe(raw);
});
