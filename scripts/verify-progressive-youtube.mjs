// Bounded read-only probe: one video, <=90s, no retry, no AI requests.
import { chromium } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const started = Date.now();
const folder = await mkdtemp(
  path.join(os.tmpdir(), "lyrics-youtube-progressive-"),
);
const report = {
  videoId: "e1ZMmRlsaaU",
  startedAt: new Date(started).toISOString(),
  limitMs: 90000,
  aiRequests: 0,
  mime: [],
  chunks: 0,
  bytes: 0,
  firstPcmMs: null,
  firstPcmBeforeComplete: false,
  pcmRanges: 0,
  pcmEndMs: 0,
  mainPaused: false,
  errors: [],
  complete: false,
};
let browser;
let stopTimer;
try {
  browser = await chromium.launchPersistentContext(folder, {
    executablePath:
      "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
    headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${path.resolve("dist")}`,
      `--load-extension=${path.resolve("dist")}`,
    ],
  });
  const worker =
    browser.serviceWorkers()[0] ??
    (await browser.waitForEvent("serviceworker", { timeout: 10000 }));
  const probe = await browser.newPage();
  await probe.goto(worker.url().replace("/background.js", "/options.html"));
  await probe.evaluate(async () => {
    const { createProgressiveDecoder } = await import(
      chrome.runtime.getURL("acoustic/progressive-decoder.js")
    );
    globalThis.codecReport = { ranges: 0, endMs: 0, errors: [] };
    globalThis.codecProbe = createProgressiveDecoder(
      (range) => {
        globalThis.codecReport.ranges++;
        globalThis.codecReport.endMs = Math.max(
          globalThis.codecReport.endMs,
          range.startMs + range.pcm.length / 16,
        );
      },
      (e) => globalThis.codecReport.errors.push(e.message),
    );
  });
  const page = await browser.newPage();
  let finish;
  const done = new Promise((resolve) => {
    finish = resolve;
  });
  stopTimer = setTimeout(
    () => {
      report.errors.push("90s hard deadline");
      finish();
    },
    Math.max(1, 90000 - (Date.now() - started)),
  );
  let serial = Promise.resolve();
  await page.exposeBinding("receiveAudioProbe", (_source, message) => {
    serial = serial
      .then(async () => {
        if (message.type === "error") {
          report.errors.push(message.message);
          finish();
          return;
        }
        if (message.type === "complete") {
          report.complete = true;
          finish();
          return;
        }
        if (message.type === "reset") {
          await probe.evaluate(
            (generation) => globalThis.codecProbe.reset(generation),
            message.generation,
          );
          return;
        }
        if (message.type !== "chunk") return;
        if (!report.mime.includes(message.mime)) report.mime.push(message.mime);
        report.chunks++;
        report.bytes += message.bytes;
        try {
          const result = await probe.evaluate(async (m) => {
            await globalThis.codecProbe.push({
              ...m,
              data: Uint8Array.from(atob(m.base64), (c) => c.charCodeAt(0))
                .buffer,
            });
            return globalThis.codecReport;
          }, message);
          report.pcmRanges = result.ranges;
          report.pcmEndMs = result.endMs;
          if (result.ranges && report.firstPcmMs === null) {
            report.firstPcmMs = Date.now() - started;
            report.firstPcmBeforeComplete = !report.complete;
          }
          if (result.endMs >= 15000 && !report.complete) finish();
        } catch (e) {
          report.errors.push(e.message.slice(0, 600));
          finish();
        }
      })
      .catch((e) => {
        report.errors.push(e.message.slice(0, 600));
        finish();
      });
    return serial;
  });
  await page.goto(`https://www.youtube.com/watch?v=${report.videoId}`, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  await page.locator("video").waitFor({ state: "attached", timeout: 15000 });
  report.mainPaused = await page.evaluate(() => {
    const v = document.querySelector("video");
    v.pause();
    return v.paused;
  });
  const nonce = crypto.randomUUID();
  await page.evaluate(
    ({ videoId, nonce }) => {
      const frame = document.createElement("iframe");
      frame.src = `https://www.youtube.com/watch?v=${videoId}&ai-lyrics-audio=${nonce}&autoplay=1&mute=1`;
      frame.allow = "autoplay";
      frame.style.cssText =
        "position:fixed;opacity:0;pointer-events:none;width:480px;height:270px";
      window.addEventListener("message", (event) => {
        if (
          event.source !== frame.contentWindow ||
          event.origin !== "https://www.youtube.com" ||
          event.data?.nonce !== nonce ||
          event.data?.tag !== "ai-lyrics-audio"
        )
          return;
        const m = event.data;
        if (m.type === "chunk") {
          const data = new Uint8Array(m.data);
          let text = "";
          for (const byte of data) text += String.fromCharCode(byte);
          void window.receiveAudioProbe({
            type: "chunk",
            base64: btoa(text),
            bytes: data.length,
            mime: m.mime,
            generation: m.generation,
            sequence: m.sequence,
            init: m.init,
          });
        } else if (["reset", "error", "complete"].includes(m.type))
          void window.receiveAudioProbe({ ...m, data: undefined });
      });
      document.documentElement.append(frame);
    },
    { videoId: report.videoId, nonce },
  );
  await done;
  report.mainPaused =
    report.mainPaused &&
    (await page
      .locator("video")
      .first()
      .evaluate((v) => v.paused));
  await probe.evaluate(() => globalThis.codecProbe.dispose()).catch(() => {});
} catch (e) {
  report.errors.push(e.message.slice(0, 600));
} finally {
  clearTimeout(stopTimer);
  if (browser) {
    report.browserVersion = browser.browser()?.version();
    await browser.close();
  }
  // mkdtemp path is verified before recursive profile cleanup.
  if (path.dirname(folder) !== os.tmpdir())
    throw new Error("Unexpected temporary profile path");
  await rm(folder, { recursive: true, force: true });
  report.elapsedMs = Date.now() - started;
  report.passed =
    report.mainPaused &&
    report.firstPcmBeforeComplete &&
    report.pcmEndMs >= 15000 &&
    report.errors.length === 0;
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/progressive-youtube.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}
