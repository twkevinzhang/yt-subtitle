import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
test("packaged pronunciation dictionary runs under MV3 module Worker CSP", async () => {
  test.setTimeout(120000);
  const folder = await mkdtemp(path.join(os.tmpdir(), "lyrics-readings-")),
    ext = path.join(folder, "extension");
  await cp("dist", ext, { recursive: true });
  await mkdir(path.join(ext, "models/onnx-community"), { recursive: true });
  await cp(
    ".tools/browser-models/onnx-community/whisper-base_timestamped",
    path.join(ext, "models/onnx-community/whisper-base_timestamped"),
    { recursive: true },
  );
  const context = await chromium.launchPersistentContext(
    path.join(folder, "profile"),
    {
      executablePath:
        "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
      headless: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    },
  );
  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    await worker.evaluate(() =>
      chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: "Bounded packaged pronunciation verification",
      }),
    );
    const reply = await worker.evaluate(() =>
      chrome.runtime.sendMessage({
        target: "acoustic-host",
        command: "local-infer",
        input: {
          key: {
            runId: "readings",
            tabId: 1,
            videoId: "12345678901",
            draftRevision: 1,
          },
          operation: "readings",
          texts: ["君の声が聞こえる", "世界はイビツで", "Neo-ism"],
        },
      }),
    );
    expect(reply, JSON.stringify(reply)).toEqual({
      ok: true,
      data: ["キミノコエガキコエル", "セカイワイビツデ", "Neo-ism"],
    });
  } finally {
    await context.close();
    if (path.dirname(folder) !== os.tmpdir())
      throw new Error("Unexpected cleanup path");
    await rm(folder, { recursive: true, force: true });
  }
});
