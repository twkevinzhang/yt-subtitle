import { test, expect, chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";

const buildFolder = path.resolve("artifacts/pcm-order-build");
test.beforeAll(async () => {
  await mkdir(buildFolder, { recursive: true });
  const exports = [
    ["createProgressiveDecoder", "progressive-decoder"],
    ["RangeAudioSource", "progressive-audio-source"],
    ["WebmDemuxer", "webm-demuxer"],
  ].map(
    ([name, file]) =>
      `export { ${name} } from ${JSON.stringify(path.resolve(`src/acoustic/${file}.ts`))};`,
  );
  const entry = path.join(buildFolder, "entry.ts");
  await writeFile(entry, exports.join("\n"));
  await build({
    configFile: false,
    logLevel: "silent",
    build: {
      outDir: buildFolder,
      emptyOutDir: false,
      minify: false,
      lib: { entry, formats: ["es"], fileName: () => "decoder.js" },
    },
  });
});

for (const [name, executablePath] of [
  [
    "Brave",
    "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
  ],
  ["Chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"],
] as const) {
  test(`${name}: drains older retained Opus before a new append without hiding real timestamp gaps`, async () => {
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--disable-background-networking", "--disable-component-update"],
    });
    try {
      const context = await browser.newContext();
      const code = await readFile(path.join(buildFolder, "decoder.js"), "utf8");
      // All page resources are fulfilled in memory; no server or media network.
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== "http://127.0.0.1:33000") return route.abort();
        return route.fulfill({
          contentType:
            url.pathname === "/decoder.js" ? "text/javascript" : "text/html",
          body:
            url.pathname === "/decoder.js"
              ? code
              : "<!doctype html><title>PCM ordering regression</title>",
        });
      });
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:33000/");
      const base64 = (
        await readFile("tests/fixtures/audio/tone.webm")
      ).toString("base64");
      const result = await page.evaluate(
        async ({ base64 }) => {
          const moduleUrl = new URL("/decoder.js", location.href).href;
          const { createProgressiveDecoder, RangeAudioSource, WebmDemuxer } =
            await import(moduleUrl);
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const source = new RangeAudioSource(11000, () => {});
          let wanted = { startMs: 0, endMs: 1000 };
          const errors: string[] = [];
          const decoder = createProgressiveDecoder(
            (range: any) => source.append(range),
            (error: Error) => errors.push(error.message),
            () => wanted,
          );
          let sequence = 0;
          const push = (data: Uint8Array) =>
            decoder.push({
              generation: 0,
              sequence,
              init: sequence++ === 0,
              mime: 'audio/webm; codecs="opus"',
              data: data.slice().buffer,
            });
          try {
            const split = Math.floor(bytes.length / 2);
            await push(bytes.slice(0, split));
            const retainedBytes = decoder.bufferedBytes();
            wanted = { startMs: 1000, endMs: 7000 };
            // Reproduce a queued native append running before decodeRequested.
            await push(bytes.slice(split));
            await decoder.decodeRequested();
            const read = await source.read(1000, 7000);
            const continuousRanges = source.availableRanges();
            const rms = Math.sqrt(
              read.pcm.reduce(
                (sum: number, sample: number) => sum + sample * sample,
                0,
              ) / read.pcm.length,
            );

            // Reuse an authentic packet from the tone fixture in a Cluster at 10s.
            // The real 8s-to-10s encoded discontinuity must remain unavailable PCM.
            let packet: Uint8Array | undefined;
            new WebmDemuxer(
              () => {},
              (value: any) => {
                if (!packet && value.timestampUs > 1500000) packet = value.data;
              },
            ).push(bytes);
            if (!packet)
              throw new Error("Tone fixture has no reusable Opus packet");
            const block = new Uint8Array(4 + packet.length);
            block.set([0x81, 0, 0, 0x80]);
            block.set(packet, 4);
            const size =
              block.length < 127
                ? [0x80 | block.length]
                : [0x40 | (block.length >> 8), block.length & 255];
            const laterCluster = new Uint8Array([
              0x1f,
              0x43,
              0xb6,
              0x75,
              0xff,
              0xe7,
              0x82,
              0x27,
              0x10,
              0xa3,
              ...size,
              ...block,
            ]);
            wanted = { startMs: 0, endMs: 11000 };
            await push(laterCluster);
            await decoder.decodeRequested();
            await decoder.finish();
            const finalRanges = source.availableRanges();
            let gapReadError = "";
            try {
              await source.read(8100, 9900);
            } catch (error) {
              gapReadError = String(error);
            }
            return {
              retainedBytes,
              samples: read.pcm.length,
              rms,
              continuousRanges,
              finalRanges,
              gapReadError,
              errors,
            };
          } finally {
            decoder.dispose();
            source.dispose();
          }
        },
        { base64 },
      );
      expect(result.errors).toEqual([]);
      expect(result.retainedBytes).toBeGreaterThan(0);
      expect(result.samples).toBe(96000);
      expect(result.rms).toBeGreaterThan(0.01);
      expect(result.continuousRanges).toHaveLength(1);
      expect(result.continuousRanges[0].startMs).toBe(0);
      expect(result.continuousRanges[0].endMs).toBeGreaterThanOrEqual(7000);
      expect(result.finalRanges).toHaveLength(2);
      expect(result.finalRanges[0].endMs).toBeLessThan(8100);
      expect(result.finalRanges[1].startMs).toBeGreaterThan(9900);
      expect(result.gapReadError).toContain("尚未取得完整 PCM 區間");
      await test.info().attach("pcm-order.json", {
        body: JSON.stringify(result, null, 2),
        contentType: "application/json",
      });
    } finally {
      await browser.close();
    }
  });
}
