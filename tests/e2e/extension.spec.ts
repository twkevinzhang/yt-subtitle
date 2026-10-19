import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdtemp, mkdir, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
test("Brave: settings, mock search, alignment, manual import, overlay and SRT", async () => {
  const requests: { path: string; body: any }[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    res.setHeader("Content-Type", "application/json");
    requests.push({ path: req.url!, body: body ? JSON.parse(body) : null });
    if (req.url === "/v1/models") {
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
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options.html`);
    await options
      .getByText("設定保存在這台電腦", { exact: false })
      .waitFor({ timeout: 15000 });
    console.log("Options loaded");
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
    await options.getByRole("button", { name: "測試連線／載入模型" }).click();
    await options
      .getByText("連線成功，取得 1 個模型。搜尋尚未驗證。")
      .waitFor();
    await mkdir("artifacts", { recursive: true });
    await options.screenshot({
      path: "artifacts/settings.png",
      fullPage: true,
    });
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
    await page.getByRole("button", { name: "AI 歌詞", exact: true }).click();
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
    await expect(page.getByRole("dialog")).toBeVisible();
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
