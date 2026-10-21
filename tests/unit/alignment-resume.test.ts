import { it, expect, vi } from "vitest";
import { runSubtitleAlignment } from "../../src/acoustic/subtitle-work";
import { normalizeSubtitle } from "../../src/lyrics/subtitle-source";
it("keeps completed timing and scanned coverage when resuming without rerunning completed rows", async () => {
  const lines = normalizeSubtitle(
    "1\n00:00:01,000 --> 00:00:03,000\nkept",
    { kind: "paste" },
    10000,
  );
  const prepare = vi.fn(),
    source = vi.fn();
  const result = await runSubtitleAlignment(
    {
      key: { runId: "r", tabId: 0, videoId: "12345678901", draftRevision: 1 },
      lines,
      durationMs: 10000,
      mode: "background",
      signal: new AbortController().signal,
      resume: {
        checked: [{ startMs: 0, endMs: 5000 }],
        ready: [{ startMs: 0, endMs: 1000 }],
      },
    },
    {
      source,
      model: { prepare, transcribe: vi.fn(), align: vi.fn(), cancel: vi.fn() },
      positionMs: () => 0,
      publish: () => {},
    },
  );
  expect(result.lines[0].startMs).toBe(1000);
  expect(result.lines[0].endMs).toBe(3000);
  expect(result.checked).toEqual([{ startMs: 0, endMs: 5000 }]);
  expect(result.ready).toEqual([{ startMs: 0, endMs: 3000 }]);
  expect(prepare).not.toHaveBeenCalled();
  expect(source).not.toHaveBeenCalled();
});
