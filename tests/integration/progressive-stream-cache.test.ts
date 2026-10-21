import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  onRange: undefined as any,
  wanted: undefined as any,
  end: 0,
  push: vi.fn(),
  decodeRequested: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("../../src/acoustic/progressive-decoder", () => ({
  createProgressiveDecoder: (onRange: any, _onError: any, wanted: any) => {
    m.onRange = onRange;
    m.wanted = wanted;
    return {
      push: m.push,
      decodeRequested: m.decodeRequested,
      bufferedBytes: () => 128,
      reset: vi.fn(),
      finish: vi.fn(),
      discontinuity: vi.fn(),
      dispose: m.dispose,
    };
  },
}));
import { createProgressiveAudioSource } from "../../src/acoustic/youtube-stream";
let audio: ReturnType<typeof createProgressiveAudioSource> | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  m.end = 0;
  const append = (end: number) => {
    m.onRange({
      generation: 0,
      startMs: m.end,
      sampleRate: 16000,
      pcm: new Float32Array((end - m.end) * 16),
    });
    m.end = end;
  };
  m.push.mockImplementation(async () => append(m.end ? 74120 : 26120));
  m.decodeRequested.mockImplementation(async () =>
    append(Math.min(70000, m.wanted().endMs + 120)),
  );
});
afterEach(() => {
  audio?.dispose();
  document.body.innerHTML = "";
});
it("uses retained packets before contacting the helper and requests only the missing suffix", async () => {
  audio = createProgressiveAudioSource(
    { videoId: "12345678901" } as any,
    80000,
  );
  const first = audio.ensure(
    { startMs: 0, endMs: 26000 },
    new AbortController().signal,
  );
  const frame = document.querySelector("iframe")!;
  const nonce = new URL(frame.src).searchParams.get("ai-lyrics-audio");
  const control = vi
    .spyOn(frame.contentWindow!, "postMessage")
    .mockImplementation(() => {});
  let sequence = 0;
  const chunk = () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        origin: "https://www.youtube.com",
        data: {
          tag: "ai-lyrics-audio",
          nonce,
          type: "chunk",
          generation: 0,
          sequence,
          init: sequence++ === 0,
          mime: "audio/webm",
          data: new ArrayBuffer(1),
        },
      }),
    );
  chunk();
  await first;
  control.mockClear();
  await audio.ensure(
    { startMs: 24000, endMs: 50000 },
    new AbortController().signal,
  );
  expect(m.decodeRequested).toHaveBeenCalledOnce();
  expect(control.mock.calls.some((c) => c[0].action === "range")).toBe(false);
  const next = audio.ensure(
    { startMs: 48000, endMs: 74000 },
    new AbortController().signal,
  );
  void next.catch(() => {}); // Failed assertions must not leave an unhandled cleanup rejection.
  await vi.waitFor(() =>
    expect(
      control.mock.calls.find((c) => c[0].action === "range")?.[0].range,
    ).toEqual({ startMs: 70000, endMs: 74000 }),
  );
  chunk();
  await next;
  expect((await audio.read(48000, 74000)).pcm).toHaveLength(416000);
});
