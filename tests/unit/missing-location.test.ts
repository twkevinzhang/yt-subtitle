import { expect, it } from "vitest";
import {
  locateMissing,
  transcriptCoverage,
  hasAcousticEvidence,
} from "../../src/acoustic/missing-location";
it("requires acoustic text evidence and skips music windows with unrelated speech", async () => {
  const lines = [
    "known",
    "You still stuck deep in that Suneo ism",
    "You better switch to 変えろ Prism that Neo ism",
  ].map((original, i) => ({
    id: "l" + i,
    original,
    cueIds: [],
    excluded: false,
    status: "unaligned" as const,
  }));
  const segments: any[] = [
    {
      id: "s",
      lineIds: ["l0"],
      contextLineIds: [],
      startMs: 0,
      endMs: 10000,
      language: "en",
      evidenceCueIds: ["c0"],
      occurrence: 1,
    },
  ];
  const cues = [
    { id: "c1", text: "[音楽]", startMs: 12000, endMs: 22000 },
    { id: "c2", text: "distinct verse", startMs: 22000, endMs: 30000 },
    { id: "c3", text: "[音楽]", startMs: 30000, endMs: 42000 },
  ];
  const windows: number[] = [],
    languages: string[] = [];
  const found = await locateMissing(
    lines,
    segments,
    cues,
    {
      availableRanges: () => [{ startMs: 0, endMs: 50000 }],
      read: async (start) => {
        windows.push(start);
        return { pcm: new Float32Array(16), sampleRate: 16000 };
      },
      dispose() {},
    },
    {
      transcribe: async (input) => {
        languages.push(input.language);
        return windows.length === 1
          ? "completely unrelated verse"
          : lines
              .slice(1)
              .map((l) => l.original)
              .join(" ");
      },
    },
    new AbortController().signal,
  );
  expect(windows).toHaveLength(2);
  expect(languages).toEqual(["en", "en"]);
  expect(found[0].lineIds).toEqual(["l1", "l2"]);
  expect(found[0].startMs).toBe(28000);
  expect(found[0].evidenceCueIds).toEqual(["c3"]);
  expect(transcriptCoverage("repeat repeat", "repeat")).toBeLessThan(0.75);
});
it("never invents a missing location when acoustic recognition does not match", async () => {
  const source: any[] = [
    { id: "l", original: "words never sung here", excluded: false },
  ];
  const found = await locateMissing(
    source,
    [],
    [{ id: "c", text: "[音楽]", startMs: 0, endMs: 10000 }],
    {
      availableRanges: () => [{ startMs: 0, endMs: 10000 }],
      read: async () => ({ pcm: new Float32Array(16), sampleRate: 16000 }),
      dispose() {},
    },
    { transcribe: async () => "instrumental" },
    new AbortController().signal,
  );
  expect(found).toEqual([]);
});
it("accepts two independently recognized line prefixes but rejects repetitive hallucinated filler", () => {
  const lyrics = [
    "You still stuck deep in that Suneo-ism.",
    "You better f**kin’ switch to 変えろ Prism.",
    "You still stuck deep in that Suneo-ism.",
    "You better f**kin’ switch to that Neo-ism",
  ];
  expect(
    hasAcousticEvidence(
      lyrics,
      "You better fucking switch to God at all Buddhism You better fucking switch to God at all Buddhism",
    ),
  ).toBe(true);
  expect(hasAcousticEvidence(lyrics, "I'm not a fan of you, ".repeat(25))).toBe(
    false,
  );
  expect(
    hasAcousticEvidence(
      lyrics,
      "You better fucking switch to God at all Buddhism",
    ),
  ).toBe(false);
});
it("recognizes a short unowned intro even when captions contain garbled text rather than music", async () => {
  const source: any[] = [
    {
      id: "intro",
      original: "You still stuck deep in that Suneo ism",
      excluded: false,
    },
    { id: "verse", original: "known verse", excluded: false },
  ];
  const segments: any[] = [
    {
      id: "verse",
      lineIds: ["verse"],
      contextLineIds: [],
      startMs: 19500,
      endMs: 35500,
      language: "ja",
      evidenceCueIds: ["garbled"],
      occurrence: 1,
    },
  ];
  const found = await locateMissing(
    source,
    segments,
    [{ id: "garbled", startMs: 4000, endMs: 20000, text: "deブレ" }],
    {
      availableRanges: () => [{ startMs: 0, endMs: 40000 }],
      read: async () => ({ pcm: new Float32Array(16), sampleRate: 16000 }),
      dispose() {},
    },
    { transcribe: async () => source[0].original },
    new AbortController().signal,
  );
  expect(found[0]?.lineIds).toEqual(["intro"]);
  expect(found[0]?.startMs).toBe(0);
  expect(found[0]?.endMs).toBe(19500);
});
