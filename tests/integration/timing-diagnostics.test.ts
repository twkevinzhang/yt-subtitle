import { it, expect } from "vitest";
import { runSubtitleAlignment } from "../../src/acoustic/subtitle-work";
import { RangeAudioSource } from "../../src/acoustic/progressive-audio-source";
import { normalizeSubtitle } from "../../src/lyrics/subtitle-source";

const key = {
  runId: "diagnostic",
  tabId: 0,
  videoId: "12345678901",
  draftRevision: 1,
};
it("reports cleanup failure as failed even after the last successful alignment", async () => {
  const { lines, audio } = fixture();
  let report: any;
  await expect(
    runSubtitleAlignment(
      {
        key,
        lines,
        durationMs: 4000,
        mode: "background",
        signal: new AbortController().signal,
      },
      {
        source: () => audio,
        model: {
          prepare: async () => {},
          cancel: async () => {
            throw new Error("cleanup failed");
          },
          transcribe: async () => lines[0].original,
          align: async () => [{ ...lines[0], startMs: 1000, endMs: 2000 }],
        },
        positionMs: () => 0,
        publish: () => {},
        onDiagnostics: (value: any) => {
          report = value;
        },
      } as any,
    ),
  ).rejects.toThrow("cleanup failed");
  expect(report).toMatchObject({
    outcome: "failed",
    interruptedStage: "cleanup",
    newlyTimed: 1,
  });
});
function fixture() {
  const lines = normalizeSubtitle(
    "an unmistakably unique sung sentence",
    { kind: "paste" },
    4000,
  );
  const audio = new RangeAudioSource(4000, () => {});
  audio.append({
    generation: 0,
    startMs: 0,
    sampleRate: 16000,
    pcm: new Float32Array(64000).fill(0.1),
  });
  return { lines, audio };
}
it("counts rejected incoming endpoints as missing before establishing the run baseline", async () => {
  const { lines, audio } = fixture();
  Object.assign(lines[0], { startMs: -100, endMs: -50 });
  let report: any;
  await runSubtitleAlignment(
    {
      key,
      lines,
      durationMs: 4000,
      mode: "background",
      signal: new AbortController().signal,
    },
    {
      source: () => audio,
      model: {
        prepare: async () => {},
        cancel: async () => {},
        transcribe: async () => lines[0].original,
        align: async () => [{ ...lines[0], startMs: 1000, endMs: 2000 }],
      },
      positionMs: () => 0,
      publish: () => {},
      onDiagnostics: (value: any) => {
        report = value;
      },
    } as any,
  );
  expect(report).toMatchObject({
    outcome: "complete",
    initialTimed: 0,
    newlyTimed: 1,
    pendingCount: 0,
  });
});
it("rejects recognition cache across source generations and reports discarded windows without new rows", async () => {
  const { lines, audio } = fixture();
  let report: any;
  await runSubtitleAlignment(
    {
      key,
      lines,
      durationMs: 4000,
      mode: "background",
      signal: new AbortController().signal,
    },
    {
      source: () => audio,
      model: {
        prepare: async () => {},
        cancel: async () => {},
        transcribe: async () => lines[0].original,
        align: async () => {
          if (audio.generation === 0) {
            audio.reset(1);
            audio.append({
              generation: 1,
              startMs: 0,
              sampleRate: 16000,
              pcm: new Float32Array(64000).fill(0.1),
            });
          }
          return [{ ...lines[0], startMs: 1000, endMs: 2000 }];
        },
      },
      positionMs: () => 0,
      publish: () => {},
      onDiagnostics: (value: any) => {
        report = value;
      },
    } as any,
  );
  expect(report).toMatchObject({
    outcome: "complete",
    newlyTimed: 1,
    cache: { hits: 0, misses: 2 },
  });
  expect(report.windows).toMatchObject([
    { outcome: "stale", newlyTimed: 0 },
    { outcome: "ok", newlyTimed: 1 },
  ]);
});
it("reports stage costs, actual recognition cache reuse and window yields without exporting text", async () => {
  const { lines, audio } = fixture();
  const reports: any[] = [];
  const result = await runSubtitleAlignment(
    {
      key,
      lines,
      durationMs: 4000,
      mode: "background",
      signal: new AbortController().signal,
    },
    {
      source: () => audio,
      model: {
        prepare: async () => {},
        cancel: async () => {},
        transcribe: async () => lines[0].original,
        align: async () => [],
      },
      positionMs: () => 0,
      publish: () => {},
      onDiagnostics: (report: any) => reports.push(report),
    } as any,
  );
  expect(result.phase).toBe("partial");
  const report = reports.at(-1);
  expect(report).toMatchObject({
    outcome: "partial",
    initialTimed: 0,
    newlyTimed: 0,
    pendingCount: 1,
    cache: { misses: 1, hits: 1 },
  });
  expect(report.totals.recognize.calls).toBe(1);
  // Existing behavior retries a passage after a rejected empty alignment.
  expect(report.totals.align.calls).toBe(4);
  expect(report.windows).toHaveLength(2);
  expect(report.windows.every((w: any) => w.newlyTimed === 0)).toBe(true);
  expect(report.pending[0]).toMatchObject({
    lineId: "l0",
    evidence: "alignment-no-result",
  });
  expect(JSON.stringify(report)).not.toContain(lines[0].original);
});
it("retains incoming locks and counts only newly completed nonexcluded rows", async () => {
  const { lines, audio } = fixture();
  const locked = {
    ...lines[0],
    id: "locked",
    original: "previous",
    startMs: 0,
    endMs: 1000,
  };
  let report: any;
  const result = await runSubtitleAlignment(
    {
      key,
      lines: [locked, ...lines],
      durationMs: 4000,
      mode: "background",
      signal: new AbortController().signal,
    },
    {
      source: () => audio,
      model: {
        prepare: async () => {},
        cancel: async () => {},
        transcribe: async () => lines[0].original,
        align: async () => [{ ...lines[0], startMs: 2000, endMs: 3000 }],
      },
      positionMs: () => 0,
      publish: () => {},
      onDiagnostics: (value: any) => {
        report = value;
      },
    } as any,
  );
  expect(result.lines[0]).toMatchObject({ startMs: 0, endMs: 1000 });
  expect(report).toMatchObject({
    outcome: "complete",
    initialTimed: 1,
    newlyTimed: 1,
    pendingCount: 0,
  });
  expect(report.windows[0].newlyTimed).toBe(1);
});
it.each([false, true])(
  "settles the interrupted stage and keeps evidence on failure or cancellation (%s)",
  async (cancel) => {
    const { lines, audio } = fixture();
    const controller = new AbortController();
    let report: any;
    await expect(
      runSubtitleAlignment(
        {
          key,
          lines,
          durationMs: 4000,
          mode: "background",
          signal: controller.signal,
        },
        {
          source: () => audio,
          model: {
            prepare: async () => {},
            cancel: async () => {},
            transcribe: async () => {
              if (cancel) controller.abort();
              throw new Error("private backend text");
            },
            align: async () => [],
          },
          positionMs: () => 0,
          publish: () => {},
          onDiagnostics: (value: any) => {
            report = value;
          },
        } as any,
      ),
    ).rejects.toThrow("private backend text");
    expect(report).toMatchObject({
      outcome: cancel ? "cancelled" : "failed",
      interruptedStage: "recognize",
      active: undefined,
    });
    expect(report.totals.recognize[cancel ? "cancelled" : "failed"]).toBe(1);
    expect(report.windows[0].outcome).toBe(cancel ? "cancelled" : "failed");
    expect(JSON.stringify(report)).not.toContain("private backend text");
  },
);
