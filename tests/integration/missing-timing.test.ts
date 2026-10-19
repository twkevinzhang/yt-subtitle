import { expect, it, vi } from "vitest";
import { fillMissingTimings } from "../../src/background/acoustic-jobs";
import { parseRevisedSubtitles } from "../../src/lyrics/revised-subtitles";
import { validateMessage } from "../../src/shared/schemas";
it("fills only missing times with no AI request and projects unchanged complete AI rows", async () => {
  const lines = parseRevisedSubtitles(
    {
      lines: [
        { text: "new first", startMs: 100, endMs: 500 },
        { text: "new missing", cueIds: ["c"] },
        { text: "new added", startMs: 1500, endMs: 1900 },
      ],
    },
    2000,
  );
  const key = {
    runId: "fill",
    tabId: 1,
    videoId: "12345678901",
    draftRevision: 1,
  };
  const host = vi.fn(async (command: string, args?: any) =>
    command === "query"
      ? {
          phase: "complete",
          snapshot: {
            key,
            sequence: 1,
            lines: [
              {
                ...lines[1],
                original: "WASM cannot replace text",
                startMs: 700,
                endMs: 1300,
              },
            ],
            segments: { s: "verified" },
            modelState: "ready",
          },
        }
      : {},
  );
  const request = vi.fn(),
    acoustic = vi.fn(async (_snapshot: any) => {});
  const tools: any = {
    runId: "fill",
    signal: new AbortController().signal,
    request,
    acoustic,
    trace: vi.fn(),
    progress: vi.fn(),
  };
  const output = await fillMissingTimings(
    {
      key,
      assetId: "asset",
      lines,
      cues: [{ id: "c", text: "missing", startMs: 600, endMs: 1400 }],
      durationMs: 2000,
      positionMs: 0,
    },
    tools,
    { host, wait: async () => {} },
  );
  expect(request).not.toHaveBeenCalled();
  const start = host.mock.calls.find(([command]) => command === "start")![1];
  expect(start.input.lines.map((l: any) => l.id)).toEqual([lines[1].id]);
  expect(output.lines[0]).toEqual(lines[0]);
  expect(output.lines[2]).toEqual(lines[2]);
  expect(output.lines[1].original).toBe("new missing");
  expect(output.lines[1].startMs).toBe(700);
  expect(acoustic.mock.calls[0][0].lines).toEqual(output.lines);
});
it("passes rejected shared times through the real message schema to the host as one coarse region", async () => {
  const lines = parseRevisedSubtitles(
    {
      lines: [
        { text: "first sentence", startMs: 40000, endMs: 48000 },
        { text: "second sentence", startMs: 40000, endMs: 48000 },
      ],
    },
    300000,
  );
  const parsed = validateMessage({
    type: "generate",
    input: {
      video: {
        schemaVersion: 1,
        videoId: "12345678901",
        title: "song",
        channel: "",
        description: "",
        durationMs: 300000,
      },
      lines,
      cues: [],
      targetLanguage: "ja",
      translate: false,
      timingOnly: true,
      audioAssetId: "asset",
      consent: {
        purpose: "generate",
        inputHash: "hash",
        settingsRevision: 1,
        confirmedAt: Date.now(),
      },
    },
  }) as any;
  expect(parsed.input.lines[0].timingHint).toEqual({
    startMs: 40000,
    endMs: 48000,
  });
  const key = {
    runId: "shared",
    tabId: 1,
    videoId: "12345678901",
    draftRevision: 1,
  };
  const host = vi.fn(async (command: string, _args?: any) =>
    command === "query"
      ? {
          phase: "complete",
          snapshot: {
            key,
            sequence: 1,
            lines: lines.map((l, i) => ({
              ...l,
              startMs: 40000 + i * 3000,
              endMs: 42000 + i * 3000,
            })),
            segments: { s: "verified" },
            modelState: "ready",
          },
        }
      : {},
  );
  const output = await fillMissingTimings(
    {
      key,
      assetId: "asset",
      lines: parsed.input.lines,
      cues: [],
      durationMs: 300000,
      positionMs: 0,
    },
    {
      signal: new AbortController().signal,
      trace: vi.fn(),
      progress: vi.fn(),
      acoustic: vi.fn(),
    } as any,
    { host },
  );
  const input = host.mock.calls.find(([c]) => c === "start")![1].input;
  expect(input.segments).toHaveLength(1);
  expect(input.segments[0]).toMatchObject({
    startMs: 40000,
    endMs: 48000,
    lineIds: lines.map((l) => l.id),
  });
  expect(output.lines.map((l) => [l.startMs, l.endMs])).toEqual([
    [40000, 42000],
    [43000, 45000],
  ]);
  expect(output.lines.map((l) => l.original)).toEqual([
    "first sentence",
    "second sentence",
  ]);
});
