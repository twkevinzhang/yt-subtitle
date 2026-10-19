import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("AI revised subtitles + real WASM fills only missing timing (mock YouTube audio transport)", async () => {
  test.setTimeout(180000);
  const models = path.resolve(
      ".tools/browser-models/onnx-community/whisper-base_timestamped",
    ),
    speech = path.resolve("artifacts/browser-probe/jfk.wav");
  try {
    await access(models);
    await access(speech);
  } catch {
    test.skip(
      true,
      "Local real model/audio unavailable; not an inference pass",
    );
    return;
  }
  const bytes = (await readFile(speech)).toString("base64");
  const text =
    "And so my fellow Americans ask not what your country can do for you ask what you can do for your country";
  let aiCalls = 0,
    helpers = 0;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    res.setHeader("Content-Type", "application/json");
    if (!raw) {
      res.end(JSON.stringify({ data: [{ id: "m" }] }));
      return;
    }
    aiCalls++;
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                lines: [
                  { text: "AI supplied text stays", startMs: 0, endMs: 100 },
                  { text, startMs: null, endMs: null, cueIds: ["c0"] },
                ],
              }),
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const folder = await mkdtemp(path.join(os.tmpdir(), "ai-lyrics-revised-")),
    extension = path.join(folder, "extension");
  let browser;
  try {
    await cp("dist", extension, { recursive: true });
    await mkdir(path.join(extension, "models/onnx-community"), {
      recursive: true,
    });
    await cp(
      models,
      path.join(extension, "models/onnx-community/whisper-base_timestamped"),
      { recursive: true },
    );
    const manifest = JSON.parse(
      await readFile(path.join(extension, "manifest.json"), "utf8"),
    );
    manifest.host_permissions.push("http://127.0.0.1/*");
    await writeFile(
      path.join(extension, "manifest.json"),
      JSON.stringify(manifest),
    );
    browser = await chromium.launchPersistentContext(
      path.join(folder, "profile"),
      {
        executablePath:
          "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
        headless: true,
        ignoreDefaultArgs: ["--disable-extensions"],
        args: [
          `--disable-extensions-except=${extension}`,
          `--load-extension=${extension}`,
        ],
      },
    );
    const worker =
      browser.serviceWorkers()[0] ??
      (await browser.waitForEvent("serviceworker"));
    await worker.evaluate(
      async (baseUrl) => {
        await chrome.storage.local.set({
          settings: {
            provider: {
              schemaVersion: 1,
              baseUrl,
              apiToken: "local-test-token",
              model: "m",
            },
            sources: [],
            preferences: {
              mode: "original",
              targetLanguage: "en",
              fontSize: 28,
              position: "bottom",
            },
            revision: 1,
          },
        });
      },
      `http://127.0.0.1:${(server.address() as any).port}/v1`,
    );
    await browser.route("https://www.youtube.com/watch*", async (route) => {
      const url = new URL(route.request().url()),
        nonce = url.searchParams.get("ai-lyrics-audio");
      if (nonce) {
        helpers++;
        expect(aiCalls).toBe(1);
        await route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><script>const data=Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0)).buffer;parent.postMessage({tag:'ai-lyrics-audio',nonce:${JSON.stringify(nonce)},type:'chunk',data},'https://www.youtube.com');parent.postMessage({tag:'ai-lyrics-audio',nonce:${JSON.stringify(nonce)},type:'complete',bytes:data.byteLength,durationMs:11000},'https://www.youtube.com');</script>`,
        });
        return;
      }
      const html = (await readFile("tests/fixtures/watch.html", "utf8"))
        .replace("lengthSeconds:'10'", "lengthSeconds:'11'")
        .replace("value:10", "value:11");
      await route.fulfill({ contentType: "text/html", body: html });
    });
    await browser.route("https://www.youtube.com/api/timedtext*", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          events: [{ tStartMs: 0, dDurationMs: 11000, segs: [{ utf8: text }] }],
        }),
      }),
    );
    const page = await browser.newPage();
    await page.goto("https://www.youtube.com/watch?v=12345678901");
    await page.getByRole("button", { name: "AI 歌詞", exact: true }).click();
    await page.getByRole("button", { name: "貼上歌詞", exact: true }).click();
    await page
      .getByLabel("歌詞全文")
      .fill("user input is not the returned subtitle");
    await page
      .getByRole("button", { name: "使用貼上歌詞", exact: true })
      .click();
    await expect(
      page.getByText("AI 對齊完成，請檢查後套用並保存。", { exact: true }),
    ).toBeVisible({ timeout: 120000 });
    expect(aiCalls).toBe(1);
    expect(helpers).toBe(1);
    const resultPanel=page.getByRole("tabpanel",{name:"歌詞結果",exact:true});
    await expect(resultPanel).toContainText("AI supplied text stays");
    await expect(resultPanel).toContainText(text);
    await page.getByRole("button", { name: "套用並保存", exact: true }).click();
    await expect(page.locator(".lyrics-preview .lyric-line")).toHaveCount(2);
    const saved = await worker.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("ai-lyrics");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        return await new Promise<any[]>((resolve, reject) => {
          const r = db.transaction("results").objectStore("results").getAll();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
      } finally {
        db.close();
      }
    });
    expect(saved[0].lines[0]).toMatchObject({
      original: "AI supplied text stays",
      startMs: 0,
      endMs: 100,
    });
    expect(saved[0].lines[1].original).toBe(text);
    expect(saved[0].lines[1].endMs).toBeGreaterThan(saved[0].lines[1].startMs);
    await mkdir("artifacts/progressive-alignment", { recursive: true });
    await writeFile(
      "artifacts/progressive-alignment/revised-real-wasm.json",
      JSON.stringify(
        {
          kind: "mock AI and audio transport, actual MV3 WASM and save",
          aiCalls,
          helpers,
          lines: saved[0].lines,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const target = path.resolve(folder);
    if (
      path.dirname(target) !== path.resolve(os.tmpdir()) ||
      !path.basename(target).startsWith("ai-lyrics-revised-")
    )
      throw new Error("Unsafe cleanup target");
    await rm(target, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
});
