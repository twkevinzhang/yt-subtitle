import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
test("Brave: settings, mock search, alignment, manual import, overlay and SRT", async () => {
  const requests: { path: string; body: any }[] = [];
  let failModels = false;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    res.setHeader("Content-Type", "application/json");
    requests.push({ path: req.url!, body: body ? JSON.parse(body) : null });
    if (req.url === "/v1/models") {
      if (failModels) res.statusCode = 503;
      res.end(JSON.stringify({ data: [{ id: "test-model" }] }));
      return;
    }
    const input = JSON.parse(body);
    const search = input.messages[0].content.includes("歌曲與歌詞搜尋");
    const payload = search
      ? {
          candidates: [
            {
              id: "1",
              title: "合成測試歌曲",
              artist: "合成演唱者",
              version: "錄音室",
              language: "ja",
              sourceId: "lrclib",
              url: "https://lrclib.net/test-song",
              fullText:
                requests.filter((r) => r.path === "/v1/chat/completions")
                  .length > 2
                  ? null
                  : "合成歌詞第一句\n合成歌詞第二句",
              syncedLyrics: null,
              matchReason: "測試用來源匹配",
            },
          ],
        }
      : {
          lines: JSON.parse(input.messages[1].content).lines.map(
            (l: any, i: number) => ({
              id: l.id,
              cueIds: [`c${i}`],
              status: "anchor",
              translation: `Translation ${i + 1}`,
            }),
          ),
        };
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(payload) } }],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  const profile = await mkdtemp(path.join(os.tmpdir(), "ai-lyrics-e2e-"));
  let context;
  // Test-only localhost grant avoids an unautomatable native permission prompt in headless Brave.
  const testExtension = path.resolve("artifacts/test-extension");
  await cp("dist", testExtension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(path.join(testExtension, "manifest.json"), "utf8"),
  );
  manifest.host_permissions.push("http://127.0.0.1/*");
  await writeFile(
    path.join(testExtension, "manifest.json"),
    JSON.stringify(manifest),
  );
  // Test-only delays reproduce slow initial settings/metadata/captions. The
  // production bundle is unchanged; every pending callback has a finite delay.
  const workerPath = path.join(testExtension, "background.js");
  await writeFile(
    workerPath,
    `
    const originalAdd = chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);
    const delayed = new Set(); globalThis.__loadingTestPending = new Set();
    const settingsReadyAt = Date.now() + 6000;
    chrome.runtime.onMessage.addListener = callback => originalAdd((message,sender,reply) => {
      const delay = message.type === 'settings-public' ? Math.max(0,settingsReadyAt-Date.now()) : {'inspect':900,'results-list':2000,'read-track':4000}[message.type];
      if(delay && (message.type === 'settings-public' || !delayed.has(message.type))) {
        delayed.add(message.type); globalThis.__loadingTestPending.add(message.type);
        setTimeout(()=>{globalThis.__loadingTestPending.delete(message.type);callback(message,sender,reply);},delay);
        return true;
      }
      return callback(message,sender,reply);
    });
  ` + (await readFile(workerPath, "utf8")),
  );
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath:
        process.env.TEST_BROWSER ||
        "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
      headless: true,
      args: [
        `--disable-extensions-except=${testExtension}`,
        `--load-extension=${testExtension}`,
        "--no-first-run",
      ],
      viewport: { width: 1440, height: 1000 },
    });
    context.setDefaultTimeout(15000);
    console.log(
      "Browser started; existing workers:",
      context.serviceWorkers().map((w) => w.url()),
    );
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker", { timeout: 15000 }));
    const id = new URL(worker.url()).host;
    console.log("Extension worker ready");
    await mkdir("artifacts", { recursive: true });
    let firstWatch = true;
    await context.route("https://www.youtube.com/watch*", async (route) => {
      let body = await readFile("tests/fixtures/watch.html", "utf8");
      if (firstWatch) {
        firstWatch = false;
        body = body.replace(
          'id="secondary-inner"',
          'id="pending-secondary-inner"',
        );
      }
      await route.fulfill({
        contentType: "text/html",
        body,
      });
    });
    const welcome = await context.newPage();
    await welcome.goto("https://www.youtube.com/watch?v=12345678901");
    await welcome.getByRole("button", { name: "AI 歌詞", exact: true }).click();
    expect(await welcome.locator("[data-ai-lyrics-panel]").count()).toBe(0);
    await welcome.evaluate(() => {
      (document.querySelector("#secondary") as HTMLElement).style.gridColumn =
        "1 / -1";
      document.querySelector("#pending-secondary-inner")!.id =
        "secondary-inner";
    });
    await welcome.evaluate(async () => {
      for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
    });
    await expect(welcome.locator("[data-ai-lyrics-panel]")).toBeHidden();
    await welcome.evaluate(() => {
      (document.querySelector("#secondary") as HTMLElement).style.gridColumn =
        "";
    });
    await welcome
      .getByRole("status", { name: "正在載入 AI 歌詞面板", exact: true })
      .waitFor();
    const skeletonBox = await welcome.locator(".panel").boundingBox();
    await welcome.screenshot({
      path: "artifacts/loading-skeleton.png",
      fullPage: true,
    });
    await welcome
      .getByRole("status", { name: "正在載入影片資訊", exact: true })
      .waitFor();
    const metadataBox = await welcome.locator(".panel").boundingBox();
    expect(
      Math.abs(metadataBox!.height - skeletonBox!.height),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(metadataBox!.width - skeletonBox!.width),
    ).toBeLessThanOrEqual(1);
    await welcome
      .getByRole("status", { name: "正在載入影片資訊", exact: true })
      .waitFor({ state: "detached" });
    const loadedBox = await welcome.locator(".panel").boundingBox();
    expect(
      Math.abs(loadedBox!.height - skeletonBox!.height),
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(loadedBox!.width - skeletonBox!.width)).toBeLessThanOrEqual(
      1,
    );
    expect(Math.abs(loadedBox!.y - skeletonBox!.y)).toBeLessThanOrEqual(1);
    expect(
      await worker.evaluate(() =>
        (globalThis as any).__loadingTestPending.has("read-track"),
      ),
    ).toBe(true);
    await welcome
      .getByRole("button", { name: "貼上／匯入", exact: true })
      .click();
    await expect(welcome.getByLabel("匯入 LRC／SRT")).toBeEnabled();
    await expect(
      welcome.getByRole("button", { name: "使用貼上歌詞", exact: true }),
    ).toBeEnabled();
    await expect(
      welcome.getByRole("heading", { name: "AI 歌詞", exact: true }),
    ).toBeVisible();
    await expect(
      welcome.getByRole("button", { name: "搜尋歌詞", exact: true }),
    ).toHaveCount(0);
    const welcomePanel = welcome.locator(".panel");
    const playerBox = await welcome.locator("#movie_player").boundingBox();
    const panelBox = await welcomePanel.boundingBox();
    expect(panelBox!.x).toBeGreaterThanOrEqual(playerBox!.x + playerBox!.width);
    expect(Math.abs(panelBox!.y - playerBox!.y)).toBeLessThanOrEqual(1);
    await expect(
      welcome.locator("#secondary-inner > [data-ai-lyrics-panel]"),
    ).toHaveCount(1);
    expect(await welcome.locator("#related").count()).toBe(1);
    await expect(
      welcome.getByRole("region", { name: "字幕編輯與預覽" }),
    ).toBeHidden();
    expect(
      await welcome
        .locator(".workspace")
        .evaluate(
          (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
        ),
    ).toBe(1);
    await welcome.getByLabel("歌詞全文").fill("切換模式保留草稿");
    await welcome.evaluate(() => {
      document.querySelector("#watch-shell")!.setAttribute("data-theater", "");
      document.body.prepend(document.querySelector("#player")!);
    });
    await expect
      .poll(async () => {
        const p = await welcome.locator("#movie_player").boundingBox();
        const w = await welcomePanel.boundingBox();
        return w!.y >= p!.y + p!.height;
      })
      .toBe(true);
    await expect(welcome.getByLabel("歌詞全文")).toHaveValue(
      "切換模式保留草稿",
    );
    await welcome.screenshot({
      path: "artifacts/sidebar-theater.png",
      fullPage: true,
    });
    await welcome.evaluate(() => {
      document
        .querySelector("#primary-inner")!
        .prepend(document.querySelector("#player")!);
      document.querySelector("#watch-shell")!.removeAttribute("data-theater");
    });
    await expect
      .poll(async () => {
        const p = await welcome.locator("#movie_player").boundingBox();
        const w = await welcomePanel.boundingBox();
        return w!.x >= p!.x + p!.width;
      })
      .toBe(true);
    await expect(welcome.getByLabel("歌詞全文")).toHaveValue(
      "切換模式保留草稿",
    );
    await welcome.getByLabel("歌詞全文").fill("");
    await welcome.getByRole("button", { name: "← 返回歌詞" }).click();
    await welcomePanel.scrollIntoViewIfNeeded();
    await expect(welcomePanel).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await welcome.screenshot({ path: "artifacts/welcome-light.png" });
    await welcome.evaluate(() =>
      document.documentElement.setAttribute("dark", ""),
    );
    await expect(welcomePanel).toHaveCSS("background-color", "rgb(25, 38, 58)");
    await welcome.screenshot({ path: "artifacts/welcome-dark.png" });
    await expect(welcome.locator(".lyrics-preview")).toContainText("測試歌曲");
    await welcome
      .getByRole("button", { name: "貼上／匯入", exact: true })
      .click();
    await welcome.getByLabel("匯入 LRC／SRT").setInputFiles({
      name: "before-ai.srt",
      mimeType: "text/plain",
      buffer: Buffer.from("1\n00:00:01,000 --> 00:00:02,000\n未設定也可使用\n"),
    });
    await expect(welcome.getByLabel("第 1 句開始秒數")).toHaveValue("1");
    await expect(
      welcome.getByRole("button", { name: "對齊／生成譯文", exact: true }),
    ).toBeDisabled();
    await welcome
      .getByRole("button", { name: "套用並保存", exact: true })
      .click();
    await welcome.getByText(/已套用並保存在本機/).waitFor();
    const localDownloadPromise = welcome.waitForEvent("download");
    await welcome
      .getByRole("button", { name: "下載 SRT", exact: true })
      .click();
    const localDownload = await localDownloadPromise;
    await localDownload.saveAs("artifacts/unconfigured-import.srt");
    expect(
      await readFile("artifacts/unconfigured-import.srt", "utf8"),
    ).toContain("未設定也可使用");
    expect(
      requests.filter((r) => r.path === "/v1/chat/completions"),
    ).toHaveLength(0);
    await welcome
      .getByRole("button", { name: "關閉面板", exact: true })
      .click();
    await expect(welcomePanel).toBeHidden();
    await welcome.getByRole("button", { name: "AI 歌詞", exact: true }).click();
    await expect(welcomePanel).toBeVisible();
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options.html`);
    await options
      .getByText("設定保存在這台電腦", { exact: false })
      .waitFor({ timeout: 15000 });
    console.log("Options loaded");
    await options.emulateMedia({ colorScheme: "light" });
    await expect(options.locator("body")).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await options.screenshot({ path: "artifacts/options-light.png" });
    await options.emulateMedia({ colorScheme: "dark" });
    await expect(options.locator("body")).toHaveCSS(
      "background-color",
      "rgb(25, 38, 58)",
    );
    await options
      .getByLabel("Base URL（通常包含 /v1）")
      .fill(`http://127.0.0.1:${address.port}/v1`);
    await options
      .getByLabel("API Token", { exact: true })
      .fill("test-only-token");
    await options.getByLabel("模型名稱", { exact: true }).fill("test-model");
    await options
      .getByRole("button", { name: "儲存設定", exact: true })
      .click();
    await options.getByText("已儲存設定。搜尋能力需另外測試。").waitFor();
    await welcome.bringToFront();
    await expect(welcome.getByText(/^先在設定頁填入/)).toHaveCount(0);
    await expect(
      welcome.getByRole("button", { name: "搜尋歌詞", exact: true }),
    ).toBeVisible();
    await expect(welcome.getByLabel("第 1 句開始秒數")).toHaveValue("1");
    await expect(
      welcome.getByRole("textbox", { name: "原文", exact: true }),
    ).toHaveValue("未設定也可使用");
    await welcome.close();
    await options.getByRole("button", { name: "測試連線／載入模型" }).click();
    await options
      .getByText("連線成功，取得 1 個模型。搜尋尚未驗證。")
      .waitFor();
    await mkdir("artifacts", { recursive: true });
    await options.screenshot({
      path: "artifacts/settings.png",
      fullPage: true,
    });
    failModels = true;
    const page = await context.newPage();
    await context.route("https://www.youtube.com/watch*", async (route) =>
      route.fulfill({
        contentType: "text/html",
        body: await readFile("tests/fixtures/watch.html", "utf8"),
      }),
    );
    await context.route("https://www.youtube.com/api/timedtext*", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          events: [
            {
              tStartMs: 1000,
              dDurationMs: 2000,
              segs: [{ utf8: "合成歌詞第一句" }],
            },
            {
              tStartMs: 4000,
              dDurationMs: 2000,
              segs: [{ utf8: "合成歌詞第二句" }],
            },
          ],
        }),
      }),
    );
    await page.goto("https://www.youtube.com/watch?v=12345678901");
    await expect(
      page.getByRole("button", { name: "AI 歌詞", exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "歡迎使用 AI 歌詞" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "AI 歌詞", exact: true }).click();
    await page
      .getByRole("button", { name: "AI 尋找歌詞", exact: true })
      .click();
    await page.getByText("已讀取 2 段字幕，可用來對齊歌詞").waitFor();
    expect(
      requests.filter((x) => x.path === "/v1/chat/completions"),
    ).toHaveLength(0);
    await page.getByRole("button", { name: "搜尋歌詞", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "開始搜尋", exact: true }),
    ).toBeVisible();
    expect(
      requests.filter((x) => x.path === "/v1/chat/completions"),
    ).toHaveLength(0);
    await page
      .getByRole("button", { name: "開始搜尋", exact: true })
      .evaluate((el) => (el as HTMLElement).click());
    await page.waitForTimeout(150);
    expect(
      requests.filter((x) => x.path === "/v1/chat/completions"),
    ).toHaveLength(0);
    await page.getByRole("button", { name: "開始搜尋", exact: true }).click();
    await page.getByRole("button", { name: "使用這個版本" }).click();
    await page.getByRole("checkbox", { name: /生成譯文/ }).check();
    await page
      .getByRole("button", { name: "對齊／生成譯文", exact: true })
      .click();
    await page
      .getByRole("button", { name: "開始對齊／翻譯", exact: true })
      .click();
    await expect(page.getByLabel("第 1 句開始秒數")).toHaveValue("1");
    // A newly chosen candidate without text must clear the previous draft; recovery is explicit.
    await page.getByRole("button", { name: "搜尋歌詞", exact: true }).click();
    await page.getByRole("button", { name: "開始搜尋", exact: true }).click();
    await page.getByRole("button", { name: "使用這個版本" }).click();
    await expect(page.getByLabel("第 1 句開始秒數")).toHaveCount(0);
    await page.getByRole("button", { name: "返回上一份草稿" }).click();
    await expect(page.getByLabel("第 1 句開始秒數")).toHaveValue("1");
    await page.getByRole("button", { name: "套用並保存" }).click();
    await page.getByText(/已套用並保存在本機/).waitFor();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "下載 SRT" }).click();
    const download = await downloadPromise;
    await download.saveAs("artifacts/synthetic-lyrics.srt");
    expect(await readFile("artifacts/synthetic-lyrics.srt", "utf8")).toContain(
      "00:00:01,000 --> 00:00:03,000",
    );
    await page.screenshot({ path: "artifacts/player.png", fullPage: true });
    expect(
      requests.filter((x) => x.path === "/v1/chat/completions"),
    ).toHaveLength(3);
    // No secret is injected into the page or model messages.
    expect(await page.content()).not.toContain("test-only-token");
    for (const r of requests.filter((x) => x.body))
      expect(JSON.stringify(r.body)).not.toContain("test-only-token");
    await page.getByRole("button", { name: "關閉面板" }).click();
    await page.getByRole("button", { name: "AI 歌詞", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "AI 歌詞工作面板", exact: true }),
    ).toBeVisible();
    const badImport = "1\n00:00:01,000 --> 00:00:02,000\n匯入測試\n";
    await page.getByLabel("匯入 LRC／SRT").setInputFiles({
      name: "local.srt",
      mimeType: "text/plain",
      buffer: Buffer.from(badImport),
    });
    await expect(page.getByLabel("第 1 句開始秒數")).toHaveValue("1");
    await page
      .getByRole("button", { name: "對齊／生成譯文", exact: true })
      .click();
    await page
      .getByRole("button", { name: "開始對齊／翻譯", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "譯文", exact: true }),
    ).toHaveValue("Translation 1");
    await expect(page.getByLabel("第 1 句結束秒數")).toHaveValue("2");
    expect(
      requests.filter((x) => x.path === "/v1/chat/completions"),
    ).toHaveLength(4);
    const longLyrics = Array.from(
      { length: 60 },
      (_, i) => `完整歌詞第 ${i + 1} 句`,
    ).join("\n");
    await page.getByLabel("歌詞全文").fill(longLyrics);
    await page
      .getByRole("button", { name: "使用貼上歌詞", exact: true })
      .click();
    await expect(page.locator(".lyrics-preview .lyric-line")).toHaveCount(60);
    const editBox = await page.locator(".panel").boundingBox();
    await page.getByRole("button", { name: "← 返回歌詞" }).click();
    const lyricsBox = await page.locator(".panel").boundingBox();
    expect(Math.abs(editBox!.height - lyricsBox!.height)).toBeLessThanOrEqual(
      1,
    );
    await page.locator(".lyrics-preview").evaluate((el) => {
      el.scrollTop = 500;
    });
    const savedScroll = await page
      .locator(".lyrics-preview")
      .evaluate((el) => el.scrollTop);
    expect(savedScroll).toBeGreaterThan(0);
    await page.getByRole("button", { name: "製作／編輯" }).click();
    await expect(page.getByLabel("歌詞全文")).toHaveValue(longLyrics);
    await page.getByRole("button", { name: "← 返回歌詞" }).click();
    expect(
      await page.locator(".lyrics-preview").evaluate((el) => el.scrollTop),
    ).toBe(savedScroll);
    await page.locator(".lyrics-preview").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.locator(".panel").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "artifacts/below-player-lyrics.png",
      fullPage: true,
    });
    await page.evaluate(() =>
      document.documentElement.setAttribute("dark", ""),
    );
    await expect(page.locator(".panel")).toHaveCSS(
      "background-color",
      "rgb(25, 38, 58)",
    );
    await page.screenshot({
      path: "artifacts/below-player-lyrics-dark.png",
      fullPage: true,
    });
    await writeFile(
      "artifacts/browser-verification.json",
      JSON.stringify(
        {
          browser: context.browser()?.version(),
          profile,
          apiRequests: requests.length,
          chatRequests: requests.filter(
            (x) => x.path === "/v1/chat/completions",
          ).length,
          kind: "synthetic fixture and local mock AI; not real YouTube/API validation",
        },
        null,
        2,
      ),
    );
  } finally {
    await context?.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
