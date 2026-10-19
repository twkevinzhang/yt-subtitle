import { chromium } from "@playwright/test";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const profile = await mkdtemp(path.join(os.tmpdir(), "ai-lyrics-youtube-"));
let context;
const report = {
  startedAt: new Date().toISOString(),
  kind: "real YouTube, fresh profile, no AI credentials",
  checks: [],
};
try {
  const dir = path.resolve("dist");
  context = await chromium.launchPersistentContext(profile, {
    executablePath:
      process.env.TEST_BROWSER ||
      "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
    headless: true,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
    viewport: { width: 1440, height: 1000 },
    timeout: 15000,
  });
  context.setDefaultTimeout(15000);
  const page = await context.newPage();
  const nativeResponses = [];
  page.on("response", async (r) => {
    if (r.url().includes("/api/timedtext")) {
      let bytes = -1;
      try {
        bytes = (await r.body()).length;
      } catch {}
      nativeResponses.push({
        status: r.status(),
        bytes,
        parameters: [...new URL(r.url()).searchParams.keys()],
      });
    }
  });
  await page.goto("https://www.youtube.com/watch?v=e1ZMmRlsaaU", {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  await page
    .getByRole("button", { name: "AI 歌詞", exact: true })
    .waitFor({ timeout: 15000 });
  report.checks.push("AI button visible");
  const play = page.locator(".ytp-play-button");
  if (await play.count()) {
    await play.click();
    await page.waitForTimeout(1500);
  }
  await page.getByRole("button", { name: "AI 歌詞", exact: true }).click();
  await page.getByRole("dialog", { name: "AI 歌詞工作面板" }).waitFor();
  await page.waitForTimeout(3000);
  const text = await page.getByRole("dialog").innerText();
  report.checks.push(text.slice(0, 2000));
  report.title = await page.title();
  if (text.includes("字幕內容讀取失敗")) {
    const cc = page.locator(".ytp-subtitles-button");
    report.ccBefore = await cc.getAttribute("aria-pressed");
    if (report.ccBefore !== "true") await cc.click();
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: "重新讀取" }).click();
    await page.waitForTimeout(1500);
    report.checks.push(
      (await page.getByRole("dialog").innerText()).slice(0, 2000),
    );
  }
  report.nativeResponses = nativeResponses;
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({
    path: "artifacts/real-youtube.png",
    fullPage: false,
  });
  report.status = "observed";
} catch (e) {
  report.status = "blocked";
  report.error = e.message?.slice(0, 800);
} finally {
  await context?.close();
  report.endedAt = new Date().toISOString();
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/real-youtube-verification.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
