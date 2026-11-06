// Explicit integration probe: isolated profile, real packaged extension and library.
// Usage: node tests/e2e/library-host.mjs AUDIO_FILE LYRICS_FILE
import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const [audioPath, lyricsPath] = process.argv.slice(2);
const cancel = process.argv.includes("--cancel");
const cancelTranscribing = process.argv.includes("--cancel-transcribing");
const requests = [];
if (!audioPath || !lyricsPath)
  throw Error("Pass local audio and exact lyric text files");
await mkdir("test-results/library-host", { recursive: true });
const extension = path.resolve("dist");
const context = await chromium.launchPersistentContext(
  path.resolve("test-results/library-host/profile"),
  {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--enable-unsafe-webgpu",
    ],
  },
);
let report;
context.on("request", (request) => requests.push(request.url()));
try {
  const background =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const id = new URL(background.url()).host;
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error")
      console.log("browser:", message.text().slice(0, 700));
  });
  await page.goto(`chrome-extension://${id}/options.html`);
  await background.evaluate(async () => {
    await chrome.offscreen.createDocument({
      url: "subtitle-host.html",
      reasons: ["WORKERS"],
      justification: "驗證真實 library 整合",
    });
  });
  await page.evaluate(
    async ({ encoded, rawText, cancel, cancelTranscribing }) => {
      const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      const decoder = new OfflineAudioContext(1, 1, 16000);
      const decoded = await decoder.decodeAudioData(bytes.buffer);
      const renderer = new OfflineAudioContext(
        1,
        Math.ceil(decoded.duration * 16000),
        16000,
      );
      const source = renderer.createBufferSource();
      source.buffer = decoded;
      source.connect(renderer.destination);
      source.start();
      const rendered = await renderer.startRendering();
      const pcm = rendered.getChannelData(0);
      const audio = {
        id: crypto.randomUUID(),
        sampleRate: 16000,
        sampleCount: pcm.length,
      };
      await new Promise((resolve, reject) => {
        const request = indexedDB.open("subtitle-audio-v1", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("audio");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("audio", "readwrite");
          tx.objectStore("audio").put({ pcm, sampleRate: 16000 }, audio.id);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
      const all = rawText.split(/\r?\n/),
        lyrics = [],
        sourceLineIndexes = [];
      all.forEach((line, index) => {
        if (line.trim()) {
          lyrics.push(line);
          sourceLineIndexes.push(index);
        }
      });
      window.__probe = {
        state: "running",
        events: [],
        duration: pcm.length / 16000,
        rawText,
      };
      const port = chrome.runtime.connect({ name: "lyric-align-host-v1" });
      port.onMessage.addListener((message) => {
        if (message.type === "progress") {
          window.__probe.events.push(message.progress);
          if (
            (cancel && window.__probe.events.length === 1) ||
            (cancelTranscribing &&
              message.progress.phase === "transcribing" &&
              message.progress.detail === "transcribing" &&
              !window.__probe.cancelled)
          ) {
            window.__probe.cancelled = true;
            port.postMessage({ type: "cancel" });
          }
        } else
          Object.assign(window.__probe, { state: message.type, ...message });
      });
      port.onDisconnect.addListener(() => {
        if (window.__probe.state === "running")
          window.__probe.state = "disconnected";
      });
      port.postMessage({
        type: "run",
        audio,
        language: "en",
        lyrics: { rawText, lyrics, sourceLineIndexes },
      });
    },
    {
      encoded: (await readFile(audioPath)).toString("base64"),
      rawText: await readFile(lyricsPath, "utf8"),
      cancel,
      cancelTranscribing,
    },
  );
  const start = Date.now();
  while (Date.now() - start < 900000) {
    report = await page.evaluate(() => window.__probe);
    if (report.state !== "running") break;
    console.log(
      JSON.stringify({
        elapsed: Math.round((Date.now() - start) / 1000),
        events: report.events.length,
        last: report.events.at(-1),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  await writeFile(
    `test-results/library-host/${cancelTranscribing ? "cancel-transcribing" : cancel ? "cancel" : "report"}.json`,
    JSON.stringify(
      {
        ...report,
        elapsedMs: Date.now() - start,
        requests,
        installedEntrySha256: createHash("sha256")
          .update(
            await readFile(
              "node_modules/lyric-align-ts/dist/index.js",
            ),
          )
          .digest("hex"),
      },
      null,
      2,
    ),
  );
  if (cancel || cancelTranscribing) {
    assert.equal(report.state, "error");
    assert.equal(report.error.code, "ABORTED");
    if (cancelTranscribing)
      assert.ok(report.events.some((event) => event.phase === "transcribing"));
    console.log("PASS: real library cancellation via offscreen port");
    process.exitCode = 0;
  } else {
    assert.equal(report.state, "result", JSON.stringify(report.error));
    assert.equal(report.result.kind, "complete");
    assert.deepEqual(
      report.result.cues.map((c) => c.text),
      report.rawText.split(/\r?\n/).filter((line) => line.trim()),
    );
    assert.ok(
      report.result.cues.every(
        (c) =>
          c.startMs >= 0 &&
          c.startMs < c.endMs &&
          c.endMs <= report.duration * 1000,
      ),
    );
    console.log(
      "PASS: packaged extension / offscreen / real Worker / exact lyrics",
      report.result.cues.length,
    );
  }
} finally {
  await context.close();
}
