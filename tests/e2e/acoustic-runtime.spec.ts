import { test, expect, chromium } from "@playwright/test";
import {
  cp,
  mkdtemp,
  readFile,
  mkdir,
  writeFile,
  access,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("Brave MV3: real WASM worker inference and warm session reuse (local acoustic fixture)", async () => {
  test.setTimeout(180000);
  const models = path.resolve(
    ".tools/browser-models/onnx-community/whisper-base_timestamped",
  );
  const speech = path.resolve("artifacts/browser-probe/jfk.wav");
  try {
    await access(models);
    await access(speech);
  } catch {
    test.skip(
      true,
      "Real model/audio fixtures unavailable; not an inference pass",
    );
    return;
  }
  const folder = await mkdtemp(path.join(os.tmpdir(), "ai-lyrics-wasm-"));
  const ext = path.join(folder, "extension");
  await cp("dist", ext, { recursive: true });
  await mkdir(path.join(ext, "models/onnx-community"), { recursive: true });
  await cp(
    models,
    path.join(ext, "models/onnx-community/whisper-base_timestamped"),
    { recursive: true },
  );
  const browser = await chromium.launchPersistentContext(
    path.join(folder, "profile"),
    {
      executablePath:
        "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
      headless: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    },
  );
  const report: any = {
    kind: "real MV3 WASM inference, fixture audio/regions; not YouTube E2E",
    jobs: [],
  };
  try {
    const worker =
      browser.serviceWorkers()[0] ??
      (await browser.waitForEvent("serviceworker"));
    const origin = worker.url().replace("/background.js", "");
    await worker.evaluate(async () => {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: "Real WASM inference integration test",
      });
    });
    const query = () =>
      worker.evaluate(() =>
        chrome.runtime.sendMessage({
          target: "acoustic-host",
          command: "query",
        }),
      );
    expect((await query()).ok).toBe(true);
    const page = await browser.newPage();
    await page.goto(origin + "/options.html");
    const base64 = (await readFile(speech)).toString("base64");
    for (let i = 0; i < 2; i++) {
      const key = {
        runId: "fixture-" + i,
        tabId: 1,
        videoId: "e1ZMmRlsaaU",
        draftRevision: i,
      };
      const duration = await page.evaluate(
        async ({ base64, assetId }) => {
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const ctx = new AudioContext({ sampleRate: 16000 });
          const audio = await ctx.decodeAudioData(bytes.buffer);
          const pcm = audio.getChannelData(0).slice();
          await ctx.close();
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const r = indexedDB.open("ai-lyrics-job-audio", 1);
            r.onupgradeneeded = () => r.result.createObjectStore("audio");
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          });
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction("audio", "readwrite");
            tx.objectStore("audio").put(pcm.buffer, assetId);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
          db.close();
          return pcm.length / 16;
        },
        { base64, assetId: key.runId },
      );
      const line = {
        id: "l1",
        original:
          "And so my fellow Americans ask not what your country can do for you ask what you can do for your country",
        cueIds: [],
        excluded: false,
        status: "unaligned",
      };
      const input = {
        key,
        assetId: key.runId,
        lines: [line],
        segments: [
          {
            id: "s1",
            lineIds: ["l1"],
            contextLineIds: [],
            startMs: 0,
            endMs: duration,
            language: "en",
            evidenceCueIds: ["fixture"],
            occurrence: 1,
          },
        ],
        positionMs: 0,
      };
      const start = Date.now();
      const reply = await worker.evaluate(
        (input) =>
          chrome.runtime.sendMessage({
            target: "acoustic-host",
            command: "start",
            input,
          }),
        input,
      );
      expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true });
      let result: any;
      await expect
        .poll(
          async () => {
            result = await query();
            return result.data?.phase;
          },
          { timeout: 90000, intervals: [200, 500] },
        )
        .not.toBe("running");
      expect(result.data.phase, JSON.stringify(result)).toBe("complete");
      expect(result.data.snapshot.segments.s1, JSON.stringify(result)).toBe(
        "verified",
      );
      expect(result.data.snapshot.lines[0].endMs).toBeGreaterThan(
        result.data.snapshot.lines[0].startMs,
      );
      expect(result.data.initializationCount).toBe(1);
      report.jobs.push({ durationMs: Date.now() - start, result: result.data });
    }
    expect(report.jobs[1].durationMs).toBeLessThan(30000);
    await worker.evaluate(() =>
      chrome.runtime.sendMessage({
        target: "acoustic-host",
        command: "dispose",
      }),
    );
    expect((await query()).data.modelState).toBe("unloaded");
    await worker.evaluate(() => chrome.offscreen.closeDocument());
    report.passed = true;
  } finally {
    await browser.close();
    await mkdir("artifacts/progressive-alignment", { recursive: true });
    await writeFile(
      "artifacts/progressive-alignment/mv3-runtime.json",
      JSON.stringify(report, null, 2),
    );
  }
});
