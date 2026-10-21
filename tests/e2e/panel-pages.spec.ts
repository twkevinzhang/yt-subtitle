import path from "node:path";
import { chromium, test, expect, type BrowserContext } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { extensionTest, watchFixture } from "./support/extension";
test("Brave: three independent search requests, route failure isolation and explicit selection", async () => {
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    res.setHeader("Content-Type", "application/json");
    if (!raw) {
      res.end(JSON.stringify({ data: [{ id: "m" }] }));
      return;
    }
    const body = JSON.parse(raw);
    requests.push(body);
    const prompt = JSON.stringify(body.input ?? body.messages);
    const route = prompt.includes("本次只查 sources")
      ? "configured"
      : prompt.includes("歌詞辨識助手")
        ? "comments"
        : "web";
    if (route === "comments") {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: { message: "留言測試失敗" } }));
      return;
    }
    const candidate = {
      id: route,
      title: route,
      artist: "artist",
      version: "live",
      language: "en",
      sourceId: route === "configured" ? "test" : "web",
      url:
        route === "configured"
          ? "https://example.com/song"
          : "https://other.example/song",
      fullText: null,
      syncedLyrics: `1\n00:00:02,000 --> 00:00:04,000\n${route} lyrics`,
      matchReason: "fixture",
    };
    res.end(
      JSON.stringify({
        output: [
          {
            type: "web_search_call",
            status: "completed",
            action: { sources: [{ url: candidate.url }] },
          },
          {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ candidates: [candidate] }),
              },
            ],
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const app = await extensionTest();
  let restarted: BrowserContext | undefined;
  try {
    await app.worker.evaluate(
      async (baseUrl) =>
        chrome.storage.local.set({
          settings: {
            provider: {
              schemaVersion: 1,
              baseUrl,
              apiToken: "local-test-token",
              model: "m",
            },
            sources: [
              {
                schemaVersion: 1,
                id: "test",
                name: "test",
                domain: "example.com",
                enabled: true,
                includeSubdomains: false,
              },
            ],
            preferences: {
              mode: "original",
              targetLanguage: "en",
              fontSize: 28,
              position: "bottom",
            },
            revision: 1,
          },
        }),
      `http://127.0.0.1:${(server.address() as any).port}/v1`,
    );
    const watchHtml = (await watchFixture())
      .replace(
        "</head>",
        "<style>@media(max-width:700px){#watch-shell{display:block;margin:0}#secondary{width:100%}#movie_player{height:480px}}</style></head>",
      )
      .replace(
        "</body>",
        '<div id="comments"><ytd-comment-thread-renderer><div id="pinned-comment-badge">置頂</div><a href="/watch?v=12345678901&lc=test-comment">date</a><div id="content-text">actual fixture lyrics</div></ytd-comment-thread-renderer></div></body>',
      );
    await app.context.route("https://www.youtube.com/watch*", (route) =>
      route.fulfill({ contentType: "text/html", body: watchHtml }),
    );
    app.context.setDefaultTimeout(15000);
    const page = await app.context.newPage();
    await page.goto("https://www.youtube.com/watch?v=12345678901");
    await page.getByRole("button", { name: "AI 歌詞", exact: true }).click();
    await page.getByRole("button", { name: "AI 找字幕", exact: true }).click();
    const configured = page.getByRole("tabpanel", {
        name: "設定的歌詞來源",
        exact: true,
      }),
      web = page.getByRole("tabpanel", { name: "全網搜尋", exact: true });
    await expect(
      configured.getByRole("button", { name: "使用這個版本" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "全網搜尋" }).click();
    await expect(
      web.getByRole("button", { name: "使用這個版本" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "YouTube 留言區" }).click();
    await expect(
      page.getByRole("tabpanel", { name: "YouTube 留言區" }),
    ).toContainText("503");
    expect(requests).toHaveLength(3);
    expect(
      requests.every(
        (r) =>
          (r.input ?? r.messages).length === 2 &&
          (r.messages ? !r.tools : r.tools[0].type === "web_search"),
      ),
    ).toBe(true);
    await page.getByRole("tab", { name: "全網搜尋" }).click();
    await web
      .locator("summary")
      .filter({ hasText: /^請求內容$/ })
      .click();
    await web.getByRole("button", { name: "完整 JSON", exact: true }).click();
    const editor = web.getByRole("textbox", { name: "完整 API JSON" });
    const edited = {
      ...JSON.parse(await editor.inputValue()),
      temperature: 0.25,
      custom: { keep: true },
    };
    await editor.fill(JSON.stringify(edited, null, 2));
    await page.getByRole("tab", { name: "設定的歌詞來源" }).click();
    await page.getByRole("tab", { name: "全網搜尋" }).click();
    await expect(editor).toHaveValue(JSON.stringify(edited, null, 2));
    await web.getByRole("button", { name: "重新發送此來源" }).click();
    await expect(
      web.getByRole("button", { name: "重新發送此來源" }),
    ).toBeVisible();
    expect(requests).toHaveLength(4);
    expect(requests[3]).toEqual(edited);
    await web
      .locator("summary")
      .filter({ hasText: /^AI 原始回覆$/ })
      .click();
    await expect(
      web
        .locator("details[open]")
        .filter({ has: page.locator("summary", { hasText: /^AI 原始回覆$/ }) })
        .locator("pre"),
    ).toBeVisible();
    await page.setViewportSize({ width: 483, height: 850 });
    await editor.scrollIntoViewIfNeeded();
    const panel = page.getByRole("region", { name: "AI 歌詞工作面板" });
    expect(await panel.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    await mkdir("artifacts/subtitle-sources", { recursive: true });
    await page.evaluate(() =>
      document.documentElement.setAttribute("dark", ""),
    );
    await expect(panel).toHaveCSS("color", "rgb(241, 241, 241)");
    await editor.fill(JSON.stringify(edited, null, 2));
    await panel.screenshot({
      path: "artifacts/subtitle-sources/request-editor.png",
    });
    await panel.locator(".panel-body").evaluate((e) => {
      e.scrollTop = 0;
    });
    await panel.screenshot({ path: "artifacts/subtitle-sources/search.png" });
    const currentTab = page.getByRole("tab", { name: "全網搜尋" });
    await currentTab.focus();
    await currentTab.press("ArrowLeft");
    await expect(
      page.getByRole("tab", { name: "YouTube 留言區" }),
    ).toBeFocused();
    await page.getByRole("tab", { name: "全網搜尋" }).click();
    await web.getByRole("button", { name: "使用這個版本" }).click();
    await expect(
      page.getByRole("textbox", { name: "原文", exact: true }),
    ).toHaveValue("web lyrics");
    await expect(page.getByLabel("第 1 句開始秒數")).toHaveValue("2");
    expect(requests).toHaveLength(4);

    await page.getByRole("button", { name: "查看搜尋結果與請求" }).click();
    await editor.fill('{"incomplete":');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await page.getByRole("button", { name: "AI 歌詞", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "AI 找字幕", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "YT 字幕", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "貼入字幕", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "繼續", exact: true }).click();
    await expect(editor).toHaveValue('{"incomplete":');
    await page.getByRole("button", { name: "回到歌詞與校時" }).click();
    await expect(
      page.getByRole("textbox", { name: "原文", exact: true }),
    ).toHaveValue("web lyrics");
    await page
      .getByRole("textbox", { name: "原文", exact: true })
      .fill("edited lyric");
    await page.getByLabel("第 1 句開始秒數").fill("2.5");
    await page.getByRole("button", { name: "查看搜尋結果與請求" }).click();
    await expect(editor).toHaveValue('{"incomplete":');
    expect(requests).toHaveLength(4);
    await page.getByRole("button", { name: "回到歌詞與校時" }).click();

    // Close the actual browser, then reopen its existing profile and extension.
    await app.context.close();
    restarted = await chromium.launchPersistentContext(
      path.join(path.dirname(app.ext), "profile"),
      {
        executablePath:
          process.env.TEST_BROWSER ||
          "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
        headless: true,
        ignoreDefaultArgs: ["--disable-extensions"],
        args: [
          "--autoplay-policy=no-user-gesture-required",
          "--disable-extensions-except=" + app.ext,
          "--load-extension=" + app.ext,
        ],
        viewport: { width: 1440, height: 1000 },
      },
    );
    restarted.setDefaultTimeout(15000);
    await restarted.route("https://www.youtube.com/watch*", (route) =>
      route.fulfill({ contentType: "text/html", body: watchHtml }),
    );
    const restoredPage = await restarted.newPage();
    await restoredPage.goto("https://www.youtube.com/watch?v=12345678901");
    await restoredPage
      .getByRole("button", { name: "AI 歌詞", exact: true })
      .click();
    await expect(
      restoredPage.getByRole("button", { name: "繼續", exact: true }),
    ).toBeEnabled();
    await restoredPage.setViewportSize({ width: 483, height: 850 });
    await restoredPage.evaluate(() =>
      document.documentElement.setAttribute("dark", ""),
    );
    await restoredPage
      .getByRole("region", { name: "AI 歌詞工作面板" })
      .screenshot({ path: "artifacts/subtitle-sources/persisted-home.png" });
    await restoredPage
      .getByRole("button", { name: "繼續", exact: true })
      .click();
    await expect(
      restoredPage.getByRole("textbox", { name: "原文", exact: true }),
    ).toHaveValue("edited lyric");
    await expect(restoredPage.getByLabel("第 1 句開始秒數")).toHaveValue("2.5");
    await restoredPage
      .getByRole("button", { name: "查看搜尋結果與請求" })
      .click();
    const restoredWeb = restoredPage.getByRole("tabpanel", {
      name: "全網搜尋",
      exact: true,
    });
    await expect(
      restoredWeb.getByRole("textbox", { name: "完整 API JSON" }),
    ).toHaveValue('{"incomplete":');
    await restoredWeb
      .locator("summary")
      .filter({ hasText: /^AI 原始回覆$/ })
      .click();
    await expect(
      restoredWeb
        .locator("details[open]")
        .filter({
          has: restoredPage.locator("summary", { hasText: /^AI 原始回覆$/ }),
        })
        .locator("pre"),
    ).toContainText("web lyrics");
    expect(requests).toHaveLength(4);
    await restoredPage
      .getByRole("button", { name: "重新載入", exact: true })
      .click();
    await expect(
      restoredPage.getByRole("button", { name: "取消", exact: true }),
    ).toBeFocused();
    await restoredPage.screenshot({
      path: "artifacts/subtitle-sources/reload-confirmation.png",
    });
    await restoredPage
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await expect(
      restoredWeb.getByRole("textbox", { name: "完整 API JSON" }),
    ).toHaveValue('{"incomplete":');
    expect(requests).toHaveLength(4);
    // Selecting a restored candidate must also work without an in-memory search group.
    await restoredWeb.getByRole("button", { name: "使用這個版本" }).click();
    await expect(
      restoredPage.getByRole("textbox", { name: "原文", exact: true }),
    ).toHaveValue("web lyrics");
    await restoredPage
      .getByRole("button", { name: "重新載入", exact: true })
      .click();
    await restoredPage.getByRole("button", { name: "清除並重新搜尋" }).click();
    await expect.poll(() => requests.length).toBe(7);
    await expect(
      restoredPage
        .getByRole("tabpanel", { name: "設定的歌詞來源", exact: true })
        .getByRole("button", { name: "使用這個版本" }),
    ).toBeVisible();
    await restoredPage.getByRole("tab", { name: "全網搜尋" }).click();
    await restoredPage
      .getByRole("tabpanel", { name: "全網搜尋", exact: true })
      .locator("summary")
      .filter({ hasText: /^請求內容$/ })
      .click();
    await expect(
      restoredPage.getByRole("textbox", { name: "模型", exact: true }),
    ).toHaveValue("m");
    expect(requests).toHaveLength(7);
  } finally {
    await restarted?.close();
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
