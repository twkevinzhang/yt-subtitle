import { it, expect, vi, afterEach } from "vitest";
import { RangeAudioSource } from "../../src/acoustic/progressive-audio-source";
afterEach(() => vi.useRealTimers());
const range = (startMs: number, endMs: number, generation = 0) => ({
  generation,
  startMs,
  sampleRate: 16000 as const,
  pcm: new Float32Array((endMs - startMs) * 16).fill(0.2),
});
it("only reads complete decoded ranges, not gaps or native coverage", async () => {
  const audio = new RangeAudioSource(10000, () => {});
  audio.append(range(0, 1000));
  audio.append(range(2000, 3000));
  await expect(audio.read(0, 2000)).rejects.toThrow();
  expect((await audio.read(0, 1000)).pcm).toHaveLength(16000);
  audio.reset(1);
  audio.append(range(0, 1000, 0));
  expect(audio.availableRanges()).toEqual([]);
  audio.dispose();
});
it("requests missing ranges and bounds the wait to 90s without renewing it", async () => {
  vi.useFakeTimers();
  const request = vi.fn();
  const audio = new RangeAudioSource(10000, request);
  const controller = new AbortController();
  const pending = audio.ensure({ startMs: 0, endMs: 1000 }, controller.signal);
  const rejected = expect(pending).rejects.toThrow(/90/);
  await vi.advanceTimersByTimeAsync(90000);
  await rejected;
  expect(request).toHaveBeenCalledTimes(1);
  audio.dispose();
});
it("resolves only after PCM arrives and evicts consumed cache within its bound", async () => {
  const audio = new RangeAudioSource(10000, () => {}, 128000);
  const p = audio.ensure(
    { startMs: 0, endMs: 1000 },
    new AbortController().signal,
  );
  audio.append(range(0, 1000));
  await p;
  audio.append(range(1000, 2000));
  audio.append(range(2000, 3000));
  expect(audio.stats().pcmBytes).toBeLessThanOrEqual(128000);
  expect(audio.availableRanges()[0].startMs).toBe(1000);
  audio.dispose();
});
it("clips only a verified terminal codec tail without manufacturing PCM", async () => {
  const audio = new RangeAudioSource(10000, () => {});
  audio.append(range(8000, 9987));
  const requested = { startMs: 8000, endMs: 10000 };
  expect(audio.readableRange(requested)).toEqual(requested);
  const pending = audio.ensure(requested, new AbortController().signal);
  audio.finish(0);
  await pending;
  expect(audio.readableRange(requested)).toEqual({
    startMs: 8000,
    endMs: 9987,
  });
  await expect(audio.read(8000, 10000)).rejects.toThrow();
  expect((await audio.read(8000, 9987)).pcm).toHaveLength(1987 * 16);
  expect(audio.availableRanges()).toEqual([{ startMs: 8000, endMs: 9987 }]);
  audio.reset(1);
  audio.append(range(8000, 9987, 1));
  audio.finish(0);
  expect(audio.readableRange(requested)).toEqual(requested);
  audio.dispose();
});
it("never clips an interior gap or a truncated song on EOF", () => {
  const audio = new RangeAudioSource(10000, () => {});
  audio.append(range(8000, 9000));
  audio.append(range(9013, 9987));
  audio.finish(0);
  expect(audio.readableRange({ startMs: 8000, endMs: 10000 })).toEqual({
    startMs: 8000,
    endMs: 10000,
  });
  expect(audio.readableRange({ startMs: 8000, endMs: 9010 })).toEqual({
    startMs: 8000,
    endMs: 9010,
  });
  const truncated = new RangeAudioSource(10000, () => {});
  truncated.append(range(8000, 9900));
  truncated.finish(0);
  expect(truncated.readableRange({ startMs: 8000, endMs: 10000 }).endMs).toBe(
    10000,
  );
});
it("accepts verified native tail without EOF only when real PCM reaches the final codec tolerance", async () => {
  const audio = new RangeAudioSource(10000, () => {});
  const wanted = { startMs: 8000, endMs: 10000 };
  audio.confirmTail(0);
  expect(audio.readableRange(wanted)).toEqual(wanted);
  const pending = audio.ensure(wanted, new AbortController().signal);
  audio.append(range(8000, 9992.5));
  await pending;
  expect(audio.readableRange(wanted).endMs).toBe(9992.5);
  expect(audio.availableRanges()).toEqual([{ startMs: 8000, endMs: 9992.5 }]);
  audio.dispose();
});
it("keeps cached coverage and byte totals correct across out-of-order appends, eviction and reset", () => {
  const audio = new RangeAudioSource(10000, () => {}, 128000);
  audio.append(range(2000, 3000));
  audio.append(range(0, 1000));
  const snapshot = audio.availableRanges();
  snapshot[0].endMs = 9000;
  audio.append(range(1000, 2000));
  expect(audio.availableRanges()).toEqual([{ startMs: 1000, endMs: 3000 }]);
  expect(audio.stats().pcmBytes).toBe(128000);
  audio.append(range(1000, 2000));
  expect(audio.stats().pcmBytes).toBe(128000);
  audio.reset(1);
  expect(audio.availableRanges()).toEqual([]);
  expect(audio.stats().pcmBytes).toBe(0);
  audio.append(range(0, 1000, 1));
  audio.dispose();
  expect(audio.stats().pcmBytes).toBe(0);
});
