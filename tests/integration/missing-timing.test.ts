import { expect, it, vi } from "vitest";
import { fillMissingTimings } from "../../src/background/acoustic-jobs";
import { parseRevisedSubtitles } from "../../src/lyrics/revised-subtitles";
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
