import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:http";

for (const [name, executablePath] of [
  [
    "Brave",
    "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
  ],
  ["Chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"],
] as const) {
  test(`${name}: decodes PCM before EOF with <=20ms tone onset error`, async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), "lyrics-progressive-"));
    const ext = path.resolve("dist");
    const server = createServer(async (req, res) => {
      if (
        req.url === "/decoder.js" ||
        req.url === "/progressive-audio-source.js"
      ) {
        res.setHeader("Content-Type", "text/javascript");
        res.end(
          await readFile(
            req.url === "/decoder.js"
              ? "dist/acoustic/progressive-decoder.js"
              : "dist/acoustic/progressive-audio-source.js",
          ),
        );
      } else {
        res.setHeader("Content-Type", "text/html");
        res.end("<!doctype html><title>Local codec test</title>");
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as { port: number };
    const browser = await chromium.launchPersistentContext(folder, {
      executablePath,
      headless: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    try {
      const page = await browser.newPage();
      let moduleUrl: string;
      if (name === "Brave") {
        const worker =
          browser.serviceWorkers()[0] ??
          (await browser.waitForEvent("serviceworker", { timeout: 15000 }));
        await page.goto(
          worker.url().replace("/background.js", "/options.html"),
        );
        moduleUrl = worker
          .url()
          .replace("/background.js", "/acoustic/progressive-decoder.js");
      } else {
        await page.goto(`http://127.0.0.1:${address.port}`);
        moduleUrl = `http://127.0.0.1:${address.port}/decoder.js`;
      }
      const data = (await readFile("tests/fixtures/audio/tone.webm")).toString(
        "base64",
      );
      const result = await page.evaluate(
        async ({ base64, moduleUrl }) => {
          const { createProgressiveDecoder } = await import(moduleUrl);
          const { RangeAudioSource } = await import(
            new URL("progressive-audio-source.js", moduleUrl).href
          );
          const source = new RangeAudioSource(8000, () => {});
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const rows: {
            startMs: number;
            sampleRate: number;
            samples: number[];
          }[] = [];
          const errors: string[] = [];
          let wanted: { startMs: number; endMs: number } | undefined;
          const decoder = createProgressiveDecoder(
            (range: any) => {
              source.append(range);
              rows.push({
                startMs: range.startMs,
                sampleRate: range.sampleRate,
                samples: [...range.pcm],
              });
            },
            (e: Error) => errors.push(e.message),
            () => wanted,
          );
          try {
            let sequence = 0;
            const end = Math.floor(bytes.length / 2);
            for (let at = 0; at < end; at += 1024) {
              await decoder.push({
                generation: 0,
                sequence,
                init: sequence++ === 0,
                mime: 'audio/webm; codecs="opus"',
                data: bytes.slice(at, Math.min(at + 1024, end)).buffer,
              });
            }
            let onsetMs = Infinity,
              sampleCount = 0;
            for (const row of rows) {
              sampleCount += row.samples.length;
              const first = row.samples.findIndex((v) => Math.abs(v) > 0.02);
              if (first >= 0)
                onsetMs = Math.min(onsetMs, row.startMs + first / 16);
            }
            const initial = {
              decodedRanges: source.availableRanges(),
              onsetMs,
              sampleCount,
              ranges: rows.length,
              lastMs: rows.at(-1)?.startMs,
              rates: [...new Set(rows.map((r) => r.sampleRate))],
              bytesSent: end,
              bytesTotal: bytes.length,
              errors,
            };
            const before = rows.length;
            wanted = { startMs: 6000, endMs: 7000 };
            for (let at = end; at < bytes.length; at += 1024) {
              await decoder.push({
                generation: 0,
                sequence,
                init: sequence++ === 0,
                mime: 'audio/webm; codecs="opus"',
                data: bytes.slice(at, at + 1024).buffer,
              });
            }
            const selected = rows
              .slice(before)
              .filter((row) => row.startMs >= 5800);
            const read = await source.read(6000, 7000).catch((error: Error) => {
              throw new Error(
                `${error.message}; PCM=${JSON.stringify(source.availableRanges())}; selected=${selected[0]?.startMs}..${selected.at(-1)?.startMs}`,
              );
            });
            return {
              ...initial,
              selected: {
                count: selected.length,
                startMs: selected[0]?.startMs,
                endMs: selected.at(-1)?.startMs,
                readSamples: read.pcm.length,
              },
              finalRanges: source.availableRanges(),
            };
          } finally {
            decoder.dispose();
          }
        },
        { base64: data, moduleUrl },
      );
      expect(result.errors).toEqual([]);
      expect(result.decodedRanges).toHaveLength(1);
      expect(result.decodedRanges[0].startMs).toBe(0);
      expect(result.decodedRanges[0].endMs).toBeGreaterThan(1000);
      expect(result.bytesSent).toBeLessThan(result.bytesTotal);
      expect(result.ranges).toBeGreaterThan(10);
      expect(result.sampleCount).toBeGreaterThan(16000);
      expect(result.rates).toEqual([16000]);
      expect(Math.abs(result.onsetMs - 1000)).toBeLessThanOrEqual(20);
      expect(result.lastMs).toBeLessThan(8000);
      expect(result.selected.count).toBeGreaterThan(30);
      expect(result.selected.count).toBeLessThan(70);
      expect(result.selected.startMs).toBeGreaterThanOrEqual(5800);
      expect(result.selected.endMs).toBeLessThan(7150);
      expect(result.selected.readSamples).toBe(16000);
      expect(result.finalRanges).toHaveLength(2);
      await test.info().attach("progressive-decoder.json", {
        body: JSON.stringify(result, null, 2),
        contentType: "application/json",
      });
    } finally {
      await browser.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      // Only remove this test's mkdtemp profile, whose parent is the OS temp folder.
      expect(path.dirname(folder)).toBe(os.tmpdir());
      await rm(folder, { recursive: true, force: true });
    }
  });
}
