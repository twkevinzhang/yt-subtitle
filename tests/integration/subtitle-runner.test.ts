import { it, expect, vi } from "vitest";
import {
  runUntimed,
  type Aligner,
  type CreateAligner,
} from "../../src/subtitle/library-runner";
import { prepareLyrics } from "../../src/subtitle/source-input";
import { audioProvider } from "../../src/subtitle/audio-provider";
import type { Progress } from "../../src/subtitle/library-contract";

const audio = (seconds = 2) => ({
  pcm: new Float32Array(16000 * seconds),
  sampleRate: 16000 as const,
});
function setup(
  cues: Array<{ start: number | null; end: number | null; matched: boolean }>,
) {
  const calls: string[] = [];
  const aligner: Aligner = {
    align: vi.fn(async (input) => {
      calls.push("align");
      input.onProgress?.({ stage: "refine", completed: 1, total: 2 });
      return { cues };
    }),
    dispose: vi.fn(() => {
      calls.push("dispose");
    }),
  };
  const create: CreateAligner = vi.fn(async (options) => {
    calls.push("create");
    options.onProgress?.({ stage: "model", completed: 5, total: 10 });
    return aligner;
  });
  return { calls, aligner, create };
}

it("keeps missing audio source explicit without a video tab", async () => {
  await expect(
    audioProvider.acquire("abcdefghijk", 10, new AbortController().signal),
  ).rejects.toMatchObject({ code: "AUDIO_UNAVAILABLE" });
});
it("aligns known lyrics directly from the audio and disposes the aligner", async () => {
  const { calls, aligner, create } = setup([
    { start: 0, end: 1, matched: true },
  ]);
  const events: Progress[] = [];
  const result = await runUntimed(
    create,
    audio(),
    prepareLyrics(" words "),
    "en",
    {
      signal: new AbortController().signal,
      onProgress: (event) => events.push(event),
    },
  );
  expect(result).toEqual({
    kind: "complete",
    cues: [{ sourceLineIndex: 0, text: " words ", startMs: 0, endMs: 1000 }],
  });
  expect(calls).toEqual(["create", "align", "dispose"]);
  const input = vi.mocked(aligner.align).mock.calls[0]![0];
  expect(input.lyrics).toEqual([" words "]);
  expect(input.language).toBe("en");
  expect(input.audio.sampleRate).toBe(16000);
  expect(events.map((e) => e.phase)).toEqual([
    "preparing-model",
    "preparing-model",
    "aligning",
    "aligning",
  ]);
  expect(events.map((e) => e.sequence)).toEqual([1, 2, 3, 4]);
  expect(events[1]).toMatchObject({
    kind: "measured",
    completed: 5,
    total: 10,
  });
});
it("detects Japanese lyrics when no language was chosen", async () => {
  const { aligner, create } = setup([{ start: 0, end: 1, matched: true }]);
  await runUntimed(
    create,
    audio(),
    prepareLyrics("吊り上がった視界から覗く"),
    undefined,
    {
      signal: new AbortController().signal,
    },
  );
  expect(vi.mocked(aligner.align).mock.calls[0]![0].language).toBe("ja");
});
it("defaults the language to English when none was chosen", async () => {
  const { aligner, create } = setup([{ start: 0, end: 1, matched: true }]);
  await runUntimed(create, audio(), prepareLyrics("a"), undefined, {
    signal: new AbortController().signal,
  });
  expect(vi.mocked(aligner.align).mock.calls[0]![0].language).toBe("en");
});
it("reports unmatched lines by their source line index", async () => {
  const { create } = setup([
    { start: 0, end: 1, matched: true },
    { start: null, end: null, matched: false },
  ]);
  expect(
    await runUntimed(create, audio(), prepareLyrics("a\n\nb"), "en", {
      signal: new AbortController().signal,
    }),
  ).toEqual({ kind: "incomplete", lineIndexes: [2] });
});
it("rejects a result whose line count differs from the lyrics", async () => {
  const { create, aligner } = setup([{ start: 0, end: 1, matched: true }]);
  await expect(
    runUntimed(create, audio(), prepareLyrics("a\nb"), "en", {
      signal: new AbortController().signal,
    }),
  ).rejects.toMatchObject({ code: "CONTRACT_VIOLATION" });
  expect(aligner.dispose).toHaveBeenCalledOnce();
});
it("rejects unsupported languages and invalid audio before model work", async () => {
  const { create } = setup([]);
  const signal = new AbortController().signal;
  await expect(
    runUntimed(create, audio(), prepareLyrics("a"), "fr", { signal }),
  ).rejects.toMatchObject({ code: "UNSUPPORTED_LANGUAGE" });
  await expect(
    runUntimed(
      create,
      { pcm: Float32Array.of(NaN), sampleRate: 16000 },
      prepareLyrics("a"),
      "en",
      { signal },
    ),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect(create).not.toHaveBeenCalled();
});
it("aborts before model work", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    runUntimed(
      (async () => {
        throw Error("must not run");
      }) as CreateAligner,
      audio(),
      prepareLyrics("a"),
      "en",
      { signal: controller.signal },
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
});
