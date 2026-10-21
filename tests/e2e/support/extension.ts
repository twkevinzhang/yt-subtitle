import { chromium } from "@playwright/test";
import { cp, readFile, writeFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
export async function extensionTest(models = false, fixturePermission = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), "lyrics-sources-")),
    ext = path.join(root, "extension");
  await cp("dist", ext, { recursive: true });
  const manifest = JSON.parse(
    await readFile(path.join(ext, "manifest.json"), "utf8"),
  );
  if (fixturePermission) manifest.host_permissions.push("http://127.0.0.1/*");
  await writeFile(path.join(ext, "manifest.json"), JSON.stringify(manifest));
  if (models) {
    await mkdir(path.join(ext, "models/onnx-community"), { recursive: true });
    await cp(
      ".tools/browser-models/onnx-community/whisper-base_timestamped",
      path.join(ext, "models/onnx-community/whisper-base_timestamped"),
      { recursive: true },
    );
  }
  const context = await chromium.launchPersistentContext(
    path.join(root, "profile"),
    {
      executablePath:
        process.env.TEST_BROWSER ||
        "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
      headless: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        "--autoplay-policy=no-user-gesture-required",
        `--disable-extensions-except=${ext}`,
        `--load-extension=${ext}`,
      ],
      viewport: { width: 1440, height: 1000 },
    },
  );
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  return {
    context,
    worker,
    ext,
    optionsUrl: worker.url().replace("/background.js", "/options.html"),
    async close() {
      await context.close();
      if (
        path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) ||
        !path.basename(root).startsWith("lyrics-sources-")
      )
        throw new Error("Unsafe cleanup");
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    },
  };
}
export async function watchFixture(manual = false) {
  let html = await readFile("tests/fixtures/watch.html", "utf8");
  if (manual) html = html.replace("kind:'asr'", "vssId:'.ja'");
  return html;
}
