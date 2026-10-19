import { expect, it } from "vitest";
import { prepareAcousticContext } from "../../src/acoustic/audio-context";
const lines: any[] = [
  { id: "l0", original: "You still stuck deep", excluded: false },
];
const segment: any = {
  id: "s",
  lineIds: ["l0"],
  contextLineIds: [],
  startMs: 3500,
  endMs: 20500,
  language: "en",
  evidenceCueIds: [],
  occurrence: 1,
};
const audio = {
  availableRanges: () => [{ startMs: 0, endMs: 300000 }],
  read: async () => ({ pcm: new Float32Array(16), sampleRate: 16000 as const }),
  dispose() {},
};
it("uses recognized prelude text instead of assigning it to the first lyric", async () => {
  const result = await prepareAcousticContext(
    segment,
    lines,
    [segment],
    [],
    audio,
    { transcribe: async () => "Yeah" },
    new AbortController().signal,
  );
  expect(result.leadingText).toBe("Yeah");
  expect(result.segment.startMs).toBe(0);
});
it("uses nearby caption text across a missing verse rather than a distant provided lyric", async () => {
  const source: any[] = [
    {
      id: "before",
      original: "previous verse",
      endMs: 163000,
      excluded: false,
    },
    { id: "tail", original: "You still stuck deep", excluded: false },
  ];
  const target = {
    ...segment,
    lineIds: ["tail"],
    startMs: 210000,
    endMs: 226000,
  };
  const result = await prepareAcousticContext(
    target,
    source,
    [target],
    [
      {
        id: "cue",
        startMs: 206000,
        endMs: 212000,
        text: "preceding spoken context",
      },
    ],
    audio,
    {},
    new AbortController().signal,
  );
  expect(result.leadingText).toBe("preceding spoken context");
  expect(result.segment.startMs).toBe(206000);
  expect(result.segment.contextLineIds).not.toContain("before");
});
it("does not extend context to the beginning of a long garbled caption", async () => {
  const source: any[] = [
    { id: "intro", original: "English intro", excluded: false },
    { id: "verse", original: "ありあまる メルセデス・ベンツ", excluded: false },
  ];
  const target = {
    ...segment,
    lineIds: ["verse"],
    startMs: 19500,
    endMs: 35500,
    language: "ja" as const,
  };
  const result = await prepareAcousticContext(
    target,
    source,
    [target],
    [{ id: "garbled", startMs: 4000, endMs: 20000, text: "deブレ" }],
    audio,
    {},
    new AbortController().signal,
  );
  expect(result.leadingText).toBeUndefined();
  expect(result.segment.startMs).toBe(17500);
});
it("keeps an acoustically recognized adlib as context when a recovered intro starts at zero", async () => {
  const result = await prepareAcousticContext(
    { ...segment, startMs: 0 },
    lines,
    [segment],
    [],
    audio,
    { transcribe: async () => "Yeah" },
    new AbortController().signal,
  );
  expect(result.leadingText).toBe("Yeah");
  expect(result.segment.startMs).toBe(0);
});
