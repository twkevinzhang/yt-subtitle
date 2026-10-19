import { afterEach, expect, it, vi } from "vitest";
import { prepareAcousticAudio } from "../../src/background/acoustic-host";
afterEach(() => vi.unstubAllGlobals());
it("waits for the offscreen cleanup acknowledgement before staging audio", async () => {
  let reply!: (value: any) => void,
    ready = false;
  const send = vi.fn(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  vi.stubGlobal("chrome", {
    runtime: {
      ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
      getURL: (p: string) => "chrome-extension://test/" + p,
      getContexts: async () => [{}],
      sendMessage: send,
    },
  });
  const preparing = prepareAcousticAudio().then(() => {
    ready = true;
  });
  await vi.waitFor(() => expect(send).toHaveBeenCalled());
  expect(ready).toBe(false);
  expect(send).toHaveBeenCalledWith({
    target: "acoustic-host",
    command: "query",
  });
  reply({ ok: true, data: { phase: "idle" } });
  await preparing;
  expect(ready).toBe(true);
});
