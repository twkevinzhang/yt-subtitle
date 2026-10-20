import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { extensionTest, watchFixture } from "./support/extension";
test("Brave: unconfigured manual/paste, exact source times, save/export and settings modes", async () => {
  const app = await extensionTest();
  let manual = true,
    helpers = 0;
  const errors: string[] = [];
  try {
    await app.context.route("https://www.youtube.com/watch*", async (route) => {
      if (new URL(route.request().url()).searchParams.has("ai-lyrics-audio"))
        helpers++;
      await route.fulfill({
        contentType: "text/html",
        body: await watchFixture(manual),
      });
    });
    await app.context.route("https://www.youtube.com/api/timedtext*", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          events: [
            {
              tStartMs: 1250,
              dDurationMs: 2000,
              segs: [{ utf8: "人工字幕原時間" }],
            },
          ],
        }),
      }),
    );
    const page = await app.context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("https://www.youtube.com/watch?v=12345678901");
    await page.getByRole("button", { name: "AI 歌詞", exact: true }).click();
    const panel = page.getByRole("region", { name: "AI 歌詞工作面板" });
    await expect(
      panel.getByRole("button", { name: "AI 找字幕", exact: true }),
    ).toBeDisabled();
    await expect(panel.locator('input[type="file"]')).toHaveCount(0);
    const yt = panel.getByRole("button", { name: "YT 字幕", exact: true });
    await expect(yt).toHaveClass(/yt-manual/);
    await yt.click();
    await expect(panel.getByLabel("第 1 句開始秒數")).toHaveValue("1.25");
    await expect(panel.getByLabel("人工 YT 字幕軌")).toBeVisible();
    await panel
      .getByRole("button", { name: "套用並保存", exact: true })
      .click();
    await expect(
      panel.getByText("已套用並保存至本機。", { exact: true }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "貼入字幕", exact: true }).click();
    await panel
      .getByLabel("字幕全文")
      .fill("1\n00:00:04,000 --> 00:00:06,000\n貼入全文\n保留換行");
    await panel
      .getByRole("button", { name: "使用貼入字幕", exact: true })
      .click();
    await expect(
      panel.getByRole("textbox", { name: "原文", exact: true }),
    ).toHaveValue("貼入全文\n保留換行");
    await panel
      .getByRole("button", { name: "套用並保存", exact: true })
      .click();
    const download = page.waitForEvent("download");
    await panel.getByRole("button", { name: "下載 SRT", exact: true }).click();
    const file = await download;
    await mkdir("artifacts/subtitle-sources", { recursive: true });
    await file.saveAs("artifacts/subtitle-sources/pasted.srt");
    expect(
      await readFile("artifacts/subtitle-sources/pasted.srt", "utf8"),
    ).toContain("00:00:04,000 --> 00:00:06,000\n貼入全文\n保留換行");
    expect(helpers).toBe(0);
    await page.screenshot({
      path: "artifacts/subtitle-sources/editor.png",
      fullPage: true,
    });
    await panel
      .getByRole("button", { name: "← 返回歌詞", exact: true })
      .click();
    await page.screenshot({
      path: "artifacts/subtitle-sources/three-actions.png",
      fullPage: true,
    });
    const options = await app.context.newPage();
    await options.goto(app.optionsUrl);
    for (const [name, value] of [
      ["播放中背景校時", "background"],
      ["整首校完再使用", "complete-before-use"],
      ["先緩衝再播放", "buffer-before-play"],
    ]) {
      await options.getByRole("radio", { name: new RegExp(name) }).check();
      await options
        .getByRole("button", { name: "儲存顯示與校時設定", exact: true })
        .click();
      await expect
        .poll(() =>
          app.worker.evaluate(
            async () =>
              (await chrome.storage.local.get("settings")).settings.preferences
                .alignmentMode,
          ),
        )
        .toBe(value);
    }
    await options.screenshot({
      path: "artifacts/subtitle-sources/settings.png",
      fullPage: true,
    });
    manual = false;
    await page.reload();
    await page.getByRole("button", { name: "AI 歌詞", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "YT 字幕", exact: true }),
    ).toBeDisabled();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
