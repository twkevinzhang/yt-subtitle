// One real video, local WASM, no AI calls; 650s hard limit, no automatic rerun.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import ts from "typescript";
const startedAtMs = Date.now();
if (!process.argv[2])
  throw new Error("Usage: node scripts/verify-youtube-timing.mjs <lyrics.txt>");
await mkdir("artifacts/timing-acceptance", { recursive: true });
await writeFile(
  "artifacts/timing-acceptance/support.mjs",
  ts.transpileModule(await readFile("tests/e2e/support/extension.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
);
const { extensionTest } =
  await import("../artifacts/timing-acceptance/support.mjs");
const report = {
  videoId: "e1ZMmRlsaaU",
  startedAt: new Date().toISOString(),
  aiRequests: 0,
  samples: [],
  errors: [],
  mode: "buffer-before-play",
};
console.log("start timing acceptance");
const app = await extensionTest(true);
const hard = setTimeout(
  () => app.context.close().catch(() => {}),
  Math.max(1, 650000 - (Date.now() - startedAtMs)),
);
try {
  const page = await app.context.newPage();
  await page.addInitScript(() => {
    globalThis.audioEvidence = { chunks: 0, bytes: 0, ads: [], errors: [] };
    window.addEventListener("message", (e) => {
      if (e.data?.tag !== "ai-lyrics-audio") return;
      const m = e.data,
        r = globalThis.audioEvidence;
      if (m.type === "chunk") {
        r.chunks++;
        r.bytes += m.data.byteLength;
      }
      if (m.type === "status") r.ads.push(m.state);
      if (m.type === "error")
        r.errors.push({ code: m.code, message: m.message });
    });
  });
  await page.goto("https://www.youtube.com/watch?v=e1ZMmRlsaaU", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page
    .getByRole("button", { name: "AI 歌詞", exact: true })
    .click({ timeout: 15000 });
  await page.evaluate(() => {
    const v = document.querySelector("video");
    v.muted = true;
    v.currentTime = 0;
  });
  await page.getByRole("button", { name: "貼入字幕", exact: true }).click();
  const text = await readFile(process.argv[2], "utf8");
  await page.getByLabel("字幕全文").fill(text);
  await page.getByRole("button", { name: "使用貼入字幕", exact: true }).click();
  const started = Date.now();
  for (let i = 0; i < 120; i++) {
    const begins = await page
      .locator('input[aria-label$="開始秒數"]')
      .evaluateAll((xs) => xs.map((x) => x.value));
    const ends = await page
      .locator('input[aria-label$="結束秒數"]')
      .evaluateAll((xs) => xs.map((x) => x.value));
    const rows = await page
      .getByRole("textbox", { name: "原文", exact: true })
      .evaluateAll((xs) => xs.map((x) => x.value));
    const aligned = rows.flatMap((original, i) =>
      begins[i] !== "" && ends[i] !== ""
        ? [
            {
              index: i,
              original,
              startMs: Number(begins[i]) * 1000,
              endMs: Number(ends[i]) * 1000,
            },
          ]
        : [],
    );
    const s = {
      atMs: Date.now() - started,
      status: await page.getByRole("status").allTextContents(),
      alerts: await page.getByRole("alert").allTextContents(),
      aligned: aligned.length,
      total: rows.length,
      busy: await page
        .getByRole("button", { name: "取消補時", exact: true })
        .count(),
    };
    report.samples.push(s);
    report.aligned = aligned;
    console.log(JSON.stringify(s));
    if (!s.busy) break;
    await new Promise((r) => setTimeout(r, 4500));
  }
  const cancel = page.getByRole("button", { name: "取消補時", exact: true });
  if (await cancel.count()) {
    report.errors.push("Acceptance deadline reached");
    await cancel.click();
  }
  report.audio = await page.evaluate(() => globalThis.audioEvidence);
  report.alerts = await page.getByRole("alert").allTextContents();
  await mkdir("artifacts/timing-acceptance", { recursive: true });
  await page.screenshot({
    path: "artifacts/timing-acceptance/editor.png",
    fullPage: true,
  });
  for (const row of report.aligned?.slice(0, 3) ?? []) {
    await page.evaluate(
      async (t) => {
        const v = document.querySelector("video");
        v.pause();
        v.currentTime = t;
        await new Promise((r) => {
          const timeout = setTimeout(r, 8000);
          v.addEventListener(
            "seeked",
            () => {
              clearTimeout(timeout);
              r();
            },
            { once: true },
          );
        });
      },
      (row.startMs + row.endMs) / 2000,
    );
    await page
      .locator("video")
      .first()
      .screenshot({
        path: `artifacts/timing-acceptance/frame-${row.index}.png`,
      });
  }
  report.finishedAt = new Date().toISOString();
  report.passed =
    report.aligned?.length >= 3 &&
    !report.alerts.length &&
    !report.errors.length &&
    !report.audio.errors.length;
} catch (e) {
  report.errors.push(e.message);
  console.log(e.message);
} finally {
  clearTimeout(hard);
  await app.close();
  await mkdir("artifacts/timing-acceptance", { recursive: true });
  await writeFile(
    "artifacts/timing-acceptance/result.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      finished: true,
      passed: report.passed,
      aligned: report.aligned?.length,
      errors: report.errors,
      alerts: report.alerts,
    }),
  );
}
