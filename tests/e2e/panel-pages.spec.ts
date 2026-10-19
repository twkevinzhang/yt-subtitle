import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import { cp, readFile, writeFile, mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("Brave: independent pages, whole-song request, editable retry and explicit apply", async () => {
  const requests: any[] = [];
  let holdReplies = false;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (!raw) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "m" }] }));
      return;
    }
    const body = JSON.parse(raw);
    requests.push(body);
    if (holdReplies) return;
    const input = JSON.parse(body.messages[1].content);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                lines: input.lines.map((l: any) => ({
                  id: l.id,
                  cueIds: [input.cues[0].id],
                  status: "anchor",
                })),
              }),
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const profile = await mkdtemp(path.join(os.tmpdir(), "ai-lyrics-pages-"));
  const extension = path.join(profile, "extension");
  let context;
  try {
    await cp("dist", extension, { recursive: true });
    const manifest = JSON.parse(
      await readFile(path.join(extension, "manifest.json"), "utf8"),
    );
    manifest.host_permissions.push("http://127.0.0.1/*");
    await writeFile(
      path.join(extension, "manifest.json"),
      JSON.stringify(manifest),
    );
    context = await chromium.launchPersistentContext(profile, {
      executablePath:
        process.env.TEST_BROWSER ||
        "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        "--no-first-run",
      ],
      viewport: { width: 1440, height: 1000 },
    });
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    await worker.evaluate(async (baseUrl) => {
      await chrome.storage.local.set({
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
              name: "測試來源",
              domain: "example.com",
              enabled: true,
              includeSubdomains: false,
            },
          ],
          preferences: {
            mode: "original",
            targetLanguage: "ja",
            fontSize: 28,
            position: "bottom",
          },
          revision: 1,
        },
      });
    }, `http://127.0.0.1:${port}/v1`);
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
            { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "歌詞" }] },
          ],
        }),
      }),
    );
    await mkdir("artifacts", { recursive: true });
    const options = await context.newPage();
    await options.goto(
      `chrome-extension://${new URL(worker.url()).host}/options.html`,
    );
    await options.emulateMedia({ colorScheme: "dark" });
    await expect(options.locator("body")).toHaveCSS(
      "background-color",
      "rgb(15, 15, 15)",
    );
    await options.screenshot({
      path: "artifacts/options-unified-dark.png",
      fullPage: true,
    });
    await options.emulateMedia({ colorScheme: "light" });
    await expect(options.locator("body")).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await options.screenshot({
      path: "artifacts/options-unified-light.png",
      fullPage: true,
    });
    const page = await context.newPage();
    await page.goto("https://www.youtube.com/watch?v=12345678901");
    await page.getByRole("button", { name: "AI 歌詞", exact: true }).click();
    await page.evaluate(() =>
      document.documentElement.setAttribute("dark", ""),
    );
    await expect(page.locator(".panel")).toHaveCSS(
      "background-color",
      "rgb(15, 15, 15)",
    );
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => document.documentElement.removeAttribute("dark"));
    await expect(page.locator(".panel header")).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );

    await page
      .getByRole("button", { name: "AI 尋找歌詞", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "開始搜尋", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("歌詞全文")).toHaveCount(0);
    await page.getByRole("button", { name: "← 返回歌詞", exact: true }).click();
    await page
      .getByRole("button", { name: "匯入 LRC／SRT", exact: true })
      .click();
    await expect(page.getByLabel("匯入 LRC／SRT")).toBeVisible();
    await expect(page.getByLabel("歌詞全文")).toHaveCount(0);
    await page.getByRole("button", { name: "← 返回歌詞", exact: true }).click();
    await page.getByRole("button", { name: "貼上歌詞", exact: true }).click();
    await page
      .getByLabel("歌詞全文")
      .fill(Array.from({ length: 81 }, (_, i) => `歌詞${i}`).join("\n"));
    await page
      .getByRole("button", { name: "使用貼上歌詞", exact: true })
      .evaluate((el) => (el as HTMLButtonElement).click());
    expect(requests).toHaveLength(0);
    await page
      .getByRole("button", { name: "使用貼上歌詞", exact: true })
      .click();
    await expect(
      page.getByText("AI 對齊完成，請檢查後套用並保存。", { exact: true }),
    ).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0].messages[1].content).lines).toHaveLength(81);
    await expect(page.getByLabel("Request body", { exact: true })).toBeHidden();
    await page.getByRole("tab", { name: "請求內容", exact: true }).click();
    const body = page.getByLabel("Request body", { exact: true });
    const initial = await body.inputValue();
    expect(initial).toContain('\n  "model"');
    await body.fill(initial.replace('"model": "m"', '"model": "edited"'));
    await page.getByRole("button", { name: "重新請求", exact: true }).click();
    await expect(
      page.getByText("AI 對齊完成，請檢查後套用並保存。", { exact: true }),
    ).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1].model).toBe("edited");
    await mkdir("artifacts", { recursive: true });
    await expect(
      page.getByRole("button", { name: "重新請求", exact: true }),
    ).toBeEnabled();
    await page.getByRole("tab", { name: "歌詞結果", exact: true }).click();
    await page.locator(".review-content").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({ path: "artifacts/panel-request-result.png" });
    await page.evaluate(() =>
      document.documentElement.setAttribute("dark", ""),
    );
    await expect(page.locator(".review-panel")).toHaveCSS(
      "background-color",
      "rgb(15, 15, 15)",
    );
    await page.screenshot({ path: "artifacts/panel-review-dark.png" });
    const footerBefore = await page.locator(".review-footer").boundingBox();
    await page.locator(".review-content").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const footerAfter = await page.locator(".review-footer").boundingBox();
    expect(Math.abs(footerBefore!.y - footerAfter!.y)).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "套用並保存", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "製作／編輯", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".lyrics-preview .lyric-line")).toHaveCount(81);
    await page.screenshot({ path: "artifacts/panel-applied.png" });
    holdReplies = true;
    for (const [trigger, confirm] of [
      ["← 返回歌詞", "取消工作並返回"],
      ["取消工作", "取消工作"],
      ["關閉面板", "取消工作並關閉"],
    ]) {
      if (
        await page
          .getByRole("button", { name: "製作／編輯", exact: true })
          .isVisible()
      )
        await page
          .getByRole("button", { name: "製作／編輯", exact: true })
          .click();
      await page.getByRole("tab", { name: "請求內容", exact: true }).click();
      const count = requests.length;
      await page.getByRole("button", { name: "重新請求", exact: true }).click();
      await expect.poll(() => requests.length).toBe(count + 1);
      await page.getByRole("button", { name: trigger, exact: true }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(
        dialog.getByRole("button", { name: "繼續等待", exact: true }),
      ).toBeFocused();
      await dialog
        .getByRole("button", { name: "繼續等待", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: trigger, exact: true }),
      ).toBeFocused();
      await page.getByRole("button", { name: trigger, exact: true }).click();
      await page.screenshot({ path: "artifacts/cancel-confirmation.png" });
      await dialog.getByRole("button", { name: confirm, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      if (trigger === "← 返回歌詞")
        await expect(
          page.getByRole("button", { name: "製作／編輯", exact: true }),
        ).toBeVisible();
      else if (trigger === "關閉面板")
        await expect(page.locator(".panel")).toBeHidden();
      else
        await expect(
          page.getByRole("button", { name: "重新請求", exact: true }),
        ).toBeEnabled();
    }
  } finally {
    await context?.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
