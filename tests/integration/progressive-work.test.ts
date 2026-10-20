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
it("never treats a lookup window as ready when only one subpassage was verified", async () => {
  const lines = normalizeSubtitle(
      "hello world\nunknown lyrics",
      { kind: "paste" },
      26000,
    ),
    audio = new RangeAudioSource(26000, () => {});
  audio.append({
    generation: 0,
    startMs: 0,
    sampleRate: 16000,
    pcm: new Float32Array(416000).fill(0.1),
  });
  const snapshots: any[] = [];
  const model = {
    prepare: async () => {},
    transcribe: async () => "hello world",
    align: async () => [
      { ...lines[0], status: "estimated" as const, startMs: 1000, endMs: 4000 },
    ],
    cancel: async () => {},
  };
  await runSubtitleAlignment(
    {
      key,
      lines,
      durationMs: 26000,
      mode: "buffer-before-play",
      signal: new AbortController().signal,
    },
    {
      source: () => audio,
      model,
      positionMs: () => 0,
      publish: (p) => snapshots.push(p),
    },
  );
  expect(
    snapshots.every((p) =>
      p.ready.every((r: any) => r.startMs >= 1000 && r.endMs <= 4000),
    ),
  ).toBe(true);
  expect(
    snapshots.some((p) =>
      p.ready.some((r: any) => r.startMs === 1000 && r.endMs === 4000),
    ),
  ).toBe(true);
});
it("retains the recognized surrounding speech when aligning an exact anchor in a noisy window", async () => {
  const lines = normalizeSubtitle("世界はイビツで", { kind: "paste" }, 10000);
  const audio = new RangeAudioSource(10000, () => {});
  audio.append({
    generation: 0,
    startMs: 0,
    sampleRate: 16000,
    pcm: new Float32Array(160000).fill(0.1),
  });
  const text =
    "とんがったくつさきからのぞく世界はイビツで花につくかわくつな俺ばまたくつずれ";
  let context: any;
  const model = {
    prepare: async () => {},
    transcribe: async () => text,
    cancel: async () => {},
    align: async (input: any) => {
      context = input;
      return [{ ...lines[0], startMs: 4000, endMs: 5000 }];
    },
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
  expect(context.leadingText).toBe("とんがったくつさきからのぞく");
  expect(context.trailingText).toBe("花につくかわくつな俺ばまたくつずれ");
  expect(result.lines[0].original).toBe("世界はイビツで");
  expect(result.phase).toBe("complete");
});
it("rejects a later exact anchor that crosses an already committed neighboring timestamp", async () => {
  const lines = normalizeSubtitle(
    "世界はイビツで\n今も忘れちゃないぜ",
    { kind: "paste" },
    10000,
  );
  const audio = new RangeAudioSource(10000, () => {});
  audio.append({
    generation: 0,
    startMs: 0,
    sampleRate: 16000,
    pcm: new Float32Array(160000).fill(0.1),
  });
  const model = {
    prepare: async () => {},
    cancel: async () => {},
    transcribe: async () =>
      "あ".repeat(60) +
      "世界はイビツで" +
      "う".repeat(60) +
      "今も忘れちゃないぜ" +
      "え".repeat(60),
    align: async (input: any) => [
      {
        ...lines.find((l) => l.id === input.segment.lineIds[0])!,
        startMs: input.segment.lineIds[0] === "l0" ? 1000 : 2000,
        endMs: input.segment.lineIds[0] === "l0" ? 3000 : 4000,
      },
    ],
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
  expect(result.lines[0].endMs).toBe(3000);
  expect(result.lines[1].startMs).toBeUndefined();
});
it("preserves existing overlapping source times while filling an unrelated later missing line", async () => {
  const lines = normalizeSubtitle(
    "first source\nsecond source\nhello world",
    { kind: "paste" },
    10000,
  );
  Object.assign(lines[0], { startMs: 1000, endMs: 3000, status: "anchor" });
  Object.assign(lines[1], { startMs: 2000, endMs: 4000, status: "anchor" });
  const audio = new RangeAudioSource(10000, () => {});
  audio.append({
    generation: 0,
    startMs: 0,
    sampleRate: 16000,
    pcm: new Float32Array(160000).fill(0.1),
  });
  const model = {
    prepare: async () => {},
    cancel: async () => {},
    transcribe: async () => "hello world",
    align: async () => [{ ...lines[2], startMs: 5000, endMs: 6000 }],
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
  expect(result.lines.map((l) => [l.startMs, l.endMs])).toEqual([
    [1000, 3000],
    [2000, 4000],
    [5000, 6000],
  ]);
});
