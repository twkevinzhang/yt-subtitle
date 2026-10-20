import { test, expect } from "@playwright/test";
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
    await app.context.route("https://www.youtube.com/watch*", async (route) =>
      route.fulfill({
        contentType: "text/html",
        body: (await watchFixture()).replace(
          "</body>",
          '<div id="comments"><ytd-comment-thread-renderer><div id="pinned-comment-badge">置頂</div><a href="/watch?v=12345678901&lc=test-comment">date</a><div id="content-text">actual fixture lyrics</div></ytd-comment-thread-renderer></div></body>',
        ),
      }),
    );
    const page = await app.context.newPage();
    await page.goto("https://www.youtube.com/watch?v=12345678901");
    await page.getByRole("button", { name: "AI 歌詞", exact: true }).click();
    await page.getByRole("button", { name: "AI 找字幕", exact: true }).click();
    const configured = page.getByRole("region", {
        name: "設定的歌詞來源",
        exact: true,
      }),
      web = page.getByRole("region", { name: "全網搜尋", exact: true });
    await expect(
      configured.getByRole("button", { name: "使用這個版本" }),
    ).toBeVisible();
    await expect(
      web.getByRole("button", { name: "使用這個版本" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "YouTube 留言區" }),
    ).toContainText("503");
    expect(requests).toHaveLength(3);
    expect(
      requests.every(
        (r) =>
          (r.input ?? r.messages).length === 2 &&
          (r.messages ? !r.tools : r.tools[0].type === "web_search"),
      ),
    ).toBe(true);
    await mkdir("artifacts/subtitle-sources", { recursive: true });
    await page.screenshot({
      path: "artifacts/subtitle-sources/search.png",
      fullPage: true,
    });
    await web.getByRole("button", { name: "使用這個版本" }).click();
    await expect(
      page.getByRole("textbox", { name: "原文", exact: true }),
    ).toHaveValue("web lyrics");
    await expect(page.getByLabel("第 1 句開始秒數")).toHaveValue("2");
    expect(requests).toHaveLength(3);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
