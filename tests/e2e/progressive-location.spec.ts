import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("real WASM: unprompted ASR locates a known passage before forced alignment", async () => {
  test.setTimeout(150000);
  const folder = await mkdtemp(
      path.join(os.tmpdir(), "lyrics-local-location-"),
    ),
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
        justification: "Bounded local ASR validation",
      }),
    );
    const page = await context.newPage();
    await page.goto(worker.url().replace("/background.js", "/options.html"));
    const stage = async (file: string, assetId: string) =>
      page.evaluate(
        async ({ base64, assetId }) => {
          const ctx = new AudioContext({ sampleRate: 16000 }),
            buffer = await ctx.decodeAudioData(
              Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer,
            );
          const pcm = buffer.getChannelData(0).slice();
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
        { base64: (await readFile(file)).toString("base64"), assetId },
      );
    const durationMs = await stage(
      "artifacts/browser-probe/jfk.wav",
      "location",
    );
    const key = {
      runId: "location",
      tabId: 1,
      videoId: "12345678901",
      draftRevision: 1,
    };
    const started = Date.now();
    const reply = await worker.evaluate(
      (input) =>
        chrome.runtime.sendMessage({
          target: "acoustic-host",
          command: "local-infer",
          input,
        }),
      { key, operation: "transcribe", assetId: "location", language: "auto" },
    );
    expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true });
    expect(String(reply.data).toLowerCase()).toContain("country");
    const speechLocated = await page.evaluate(async (observed) => {
      const { matchLyricWindow } = await import(
        chrome.runtime.getURL("acoustic/lyric-locator.js")
      );
      return matchLyricWindow(
        [
          {
            id: "speech",
            original:
              "And so my fellow Americans ask not what your country can do for you ask what you can do for your country",
            cueIds: [],
            status: "unaligned",
            excluded: false,
            timing: {},
          },
        ],
        observed,
        { startMs: 0, endMs: 11000 },
      );
    }, reply.data);
    expect(speechLocated.segments).toHaveLength(1);
    const songDuration = Math.min(
      26000,
      await stage("artifacts/opening.wav", "song-opening"),
    );
    const songStart = Date.now();
    const song = await worker.evaluate(
      (input) =>
        chrome.runtime.sendMessage({
          target: "acoustic-host",
          command: "local-infer",
          input,
        }),
      {
        key,
        operation: "transcribe",
        assetId: "song-opening",
        language: "auto",
      },
    );
    expect(song, JSON.stringify(song)).toMatchObject({ ok: true });
    const lyrics = JSON.parse(
      await readFile("tests/fixtures/reported-song-request.json", "utf8"),
    ).data.lyrics;
    const located = await page.evaluate(
      async ({ lyrics, observed, durationMs }) => {
        const { matchLyricWindow } = await import(
          chrome.runtime.getURL("acoustic/lyric-locator.js")
        );
        const lines = lyrics
          .filter((l: any) => !/^[(（]/.test(l.text))
          .map((l: any, i: number) => ({
            id: `l${i}`,
            original: l.text,
            cueIds: [],
            status: "unaligned",
            excluded: false,
            timing: {},
          }));
        return matchLyricWindow(lines, observed, {
          startMs: 0,
          endMs: durationMs,
        });
      },
      { lyrics, observed: song.data, durationMs: songDuration },
    );
    expect(
      located.segments.length,
      JSON.stringify({ observed: song.data, located }),
    ).toBe(0); // Measured weak music ASR must stay pending, never invent a location.
    await mkdir("artifacts/progressive-alignment", { recursive: true });
    await writeFile(
      "artifacts/progressive-alignment/local-location.json",
      JSON.stringify(
        {
          durationMs,
          elapsedMs: Date.now() - started,
          observed: reply.data,
          speechLocated,
          song: {
            durationMs: songDuration,
            elapsedMs: Date.now() - songStart,
            observed: song.data,
            located,
          },
          kind: "real unprompted local WASM ASR, speech and existing song excerpt; not full-song accuracy guarantee",
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
    if (path.dirname(folder) !== os.tmpdir())
      throw new Error("Unexpected cleanup path");
    await rm(folder, { recursive: true, force: true });
  }
});
