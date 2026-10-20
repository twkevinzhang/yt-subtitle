import { it, expect, vi } from "vitest";
import { runSubtitleAlignment } from "../../src/acoustic/subtitle-work";
import { normalizeSubtitle } from "../../src/lyrics/subtitle-source";
import { RangeAudioSource } from "../../src/acoustic/progressive-audio-source";
const key = { runId: "a", tabId: 0, videoId: "12345678901", draftRevision: 1 };
it("does not initialize audio or a model for complete source times", async () => {
  const model = {
    prepare: vi.fn(),
    transcribe: vi.fn(),
    align: vi.fn(),
    cancel: vi.fn(async () => {}),
  };
  const source = vi.fn();
  const lines = normalizeSubtitle(
    "1\n00:00:01,000 --> 00:00:03,000\nhello",
    { kind: "paste" },
    10000,
  );
  const result = await runSubtitleAlignment(
    {
      key,
      lines,
      durationMs: 10000,
      mode: "background",
      signal: new AbortController().signal,
    },
    { source, model, positionMs: () => 0, publish: () => {} },
  );
  expect(result.lines[0].startMs).toBe(1000);
  expect(model.prepare).not.toHaveBeenCalled();
  expect(source).not.toHaveBeenCalled();
});
it("only fills missing endpoints and keeps unmatched text in the final partial result", async () => {
  const lines = normalizeSubtitle(
    "hello world\nunknown lyrics",
    { kind: "paste" },
    10000,
  );
  lines[0].startMs = 1000;
  lines[0].timing.start = { valueMs: 1000, locked: true, origin: "source" };
  const audio = new RangeAudioSource(10000, () => {});
  audio.append({
    generation: 0,
    startMs: 0,
    sampleRate: 16000,
    pcm: new Float32Array(160000).fill(0.1),
  });
  const model = {
    prepare: vi.fn(async () => {}),
    transcribe: vi.fn(async () => "hello world"),
    align: vi.fn(async () => [{ ...lines[0], startMs: 2000, endMs: 4000 }]),
    cancel: vi.fn(async () => {}),
  };
  const result = await runSubtitleAlignment(
    {
      key,
      lines,
      durationMs: 10000,
      mode: "background",
      signal: new AbortController().signal,
    },
    { source: () => audio, model, positionMs: () => 0, publish: () => {} },
  );
  expect(result.lines[0].startMs).toBe(1000);
  expect(result.lines[0].endMs).toBe(4000);
  expect(result.lines[1].original).toBe("unknown lyrics");
  expect(result.phase).toBe("partial");
});
it("discards a recognition result across an ad generation reset and reruns only on fresh PCM", async () => {
  const lines = normalizeSubtitle("hello world", { kind: "paste" }, 10000),
    audio = new RangeAudioSource(10000, () => {});
  const append = () =>
    audio.append({
      generation: audio.generation,
      startMs: 0,
      sampleRate: 16000,
      pcm: new Float32Array(160000).fill(0.1),
    });
  append();
  let calls = 0;
  const model = {
    prepare: async () => {},
    transcribe: vi.fn(async () => {
      if (calls++ === 0) {
        audio.reset(1);
        append();
        return "unrelated stale transcript";
      }
      return "hello world";
    }),
    align: vi.fn(async () => [
      { ...lines[0], status: "estimated" as const, startMs: 1000, endMs: 2000 },
    ]),
    cancel: async () => {},
  };
  const result = await runSubtitleAlignment(
    {
      key,
      lines,
      durationMs: 10000,
      mode: "background",
      signal: new AbortController().signal,
    },
    { source: () => audio, model, positionMs: () => 0, publish: () => {} },
  );
  expect(model.transcribe).toHaveBeenCalledTimes(2);
  expect(model.align).toHaveBeenCalledTimes(1);
  expect(result.phase).toBe("complete");
  expect(result.generation).toBe(1);
});
