import { it, expect, vi } from "vitest";
import { runUntimed } from "../../src/subtitle/library-runner";
import { prepareLyrics } from "../../src/subtitle/source-input";
import { resolveLibrary } from "../../src/subtitle/library-loader";
import { audioProvider } from "../../src/subtitle/audio-provider";
it("keeps missing library and audio sources explicit", async () => {
  expect(await resolveLibrary()).toBeNull();
  await expect(
    audioProvider.acquire("abcdefghijk", 10, new AbortController().signal),
  ).rejects.toMatchObject({ code: "AUDIO_UNAVAILABLE" });
});
it("calls library in order, preserves lyrics and disposes on success", async () => {
  const calls: string[] = [];
  const session = {
    prepare: vi.fn(async () => {
      calls.push("prepare");
    }),
    transcribe: vi.fn(async () => {
      calls.push("transcribe");
      return [];
    }),
    align: vi.fn(async (_segments: unknown, lyrics: readonly string[]) => {
      calls.push("align");
      return lyrics.map((line) => ({
        line,
        start: 0,
        end: 1,
        matched: true,
        score: 1,
      }));
    }),
    dispose: vi.fn(async () => {
      calls.push("dispose");
    }),
  };
  const binding = {
    capabilities: {
      contractVersion: 1 as const,
      libraryVersion: "test",
      supportedLanguages: ["en"],
      model: {
        id: "test",
        revision: "1",
        device: "webgpu" as const,
        dtype: "q4",
      },
      alignmentOptions: [],
      lyricsContext: true,
    },
    createSession: async () => session,
  };
  expect(
    (
      await runUntimed(
        binding,
        { pcm: new Float32Array(32000), sampleRate: 16000 },
        prepareLyrics(" words "),
        "en",
        { signal: new AbortController().signal },
      )
    ).kind,
  ).toBe("complete");
  expect(calls).toEqual(["prepare", "transcribe", "align", "dispose"]);
  expect(session.align.mock.calls[0][1]).toEqual([" words "]);
});
it("aborts before model work", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    runUntimed(
      {} as never,
      { pcm: new Float32Array(1), sampleRate: 16000 },
      prepareLyrics("a"),
      "en",
      { signal: controller.signal },
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
});
