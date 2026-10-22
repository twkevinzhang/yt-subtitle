import { expect, it, vi } from "vitest";
const release = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../src/subtitle/audio-store", () => ({ releaseAudio: release }));
import { runInHost } from "../../src/subtitle/host-client";
it("cancels a waiting job immediately without closing the active host", async () => {
  let receive!: (message: any) => void;
  const close = vi.fn(async () => {});
  const connect = vi.fn(() => ({
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener: (fn: any) => {
        receive = fn;
      },
    },
    onDisconnect: { addListener: vi.fn() },
  }));
  vi.stubGlobal("chrome", {
    runtime: {
      getURL: (x: string) => x,
      getContexts: async () => [{}],
      ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
      connect,
    },
    offscreen: { closeDocument: close },
  });
  const lyrics = { rawText: "a", lyrics: ["a"], sourceLineIndexes: [0] };
  const first = runInHost(
    { id: "first", sampleRate: 16000, sampleCount: 1 },
    lyrics,
    "en",
    new AbortController().signal,
    () => {},
  );
  await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
  const controller = new AbortController();
  const second = runInHost(
    { id: "second", sampleRate: 16000, sampleCount: 1 },
    lyrics,
    "en",
    controller.signal,
    () => {},
  );
  const rejection = expect(second).rejects.toMatchObject({ code: "ABORTED" });
  controller.abort();
  await rejection;
  expect(release).toHaveBeenCalledWith("second");
  expect(close).not.toHaveBeenCalled();
  receive({ type: "result", result: { kind: "incomplete", lineIndexes: [0] } });
  await first;
  vi.unstubAllGlobals();
});
