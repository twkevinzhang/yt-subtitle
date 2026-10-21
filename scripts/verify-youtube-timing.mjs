// One real video, local WASM, no AI calls; 650s hard limit, no automatic rerun.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import ts from "typescript";
const startedAtMs = Date.now();
if (!process.argv[2])
  throw new Error(
    "Usage: node scripts/verify-youtube-timing.mjs <lyrics.txt> [--exclude-lines=1,3,...]",
  );
const excludeOption = process.argv
  .slice(3)
  .find((arg) => arg.startsWith("--exclude-lines="));
const excludeLines = excludeOption
  ? excludeOption.slice("--exclude-lines=".length).split(",").map(Number)
  : [];
if (
  excludeLines.some((n) => !Number.isInteger(n) || n < 1) ||
  new Set(excludeLines).size !== excludeLines.length
)
  throw new Error("排除行號必須是明確、唯一的正整數");
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
const app = await extensionTest(true, false);
const hard = setTimeout(
  () => app.context.close().catch(() => {}),
  Math.max(1, 650000 - (Date.now() - startedAtMs)),
);
try {
  const page = await app.context.newPage();
  await page.addInitScript(() => {
    globalThis.audioEvidence = {
      chunks: 0,
      bytes: 0,
      ads: [],
      errors: [],
      adChunks: 0,
      state: "content",
    };
    window.addEventListener("message", (e) => {
      if (e.data?.tag !== "ai-lyrics-audio") return;
      const m = e.data,
        r = globalThis.audioEvidence;
      if (m.type === "chunk") {
        if (r.state !== "content") r.adChunks++;
        r.chunks++;
        r.bytes += m.data.byteLength;
      }
      if (m.type === "status") {
        r.ads.push(m.state);
        r.state = m.state;
      }
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
  report.durationMs = await page
    .locator("video")
    .first()
    .evaluate((v) => Math.round(v.duration * 1000));
  await page.getByRole("button", { name: "貼入字幕", exact: true }).click();
  const text = await readFile(process.argv[2], "utf8");
  await page.getByLabel("字幕全文").fill(text);
  await page.getByRole("button", { name: "使用貼入字幕", exact: true }).click();
  const originalRows = await page.locator(".editor-row").evaluateAll((xs) =>
    xs.map((x) => ({
      original: x.querySelector("textarea").value,
      start: x.querySelector('input[aria-label$="開始秒數"]').value,
      end: x.querySelector('input[aria-label$="結束秒數"]').value,
    })),
  );
  if (excludeLines.some((n) => n > originalRows.length))
    throw new Error("排除行號超出原文行數");
  report.originalRows = originalRows;
  report.excludedLines = excludeLines;
  if (excludeLines.length) {
    const cancel = page.getByRole("button", { name: "取消補時", exact: true });
    if (await cancel.count()) await cancel.click();
    for (const n of excludeLines)
      await page
        .locator(".editor-row")
        .nth(n - 1)
        .getByRole("checkbox", { name: "排除這句", exact: true })
        .setChecked(true);
    await page.getByRole("button", { name: "重新補時", exact: true }).click();
  }
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
              startMs: Math.round(Number(begins[i]) * 1000),
              endMs: Math.round(Number(ends[i]) * 1000),
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
      activeTotal: rows.length - excludeLines.length,
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
  const alignedByIndex = new Map(
    (report.aligned ?? []).map((row) => [row.index, row]),
  );
  const finalOriginals = await page
    .getByRole("textbox", { name: "原文", exact: true })
    .evaluateAll((xs) => xs.map((x) => x.value));
  report.originalsPreserved =
    originalRows.length === finalOriginals.length &&
    originalRows.every((row, i) => finalOriginals[i] === row.original);
  report.sourceTimesPreserved = originalRows.every((row, i) => {
    const found = alignedByIndex.get(i);
    return (
      (row.start === "" ||
        found?.startMs === Math.round(Number(row.start) * 1000)) &&
      (row.end === "" || found?.endMs === Math.round(Number(row.end) * 1000))
    );
  });
  report.wholeSongTimed = originalRows.every(
    (_, i) =>
      excludeLines.includes(i + 1) ||
      (Number.isFinite(alignedByIndex.get(i)?.startMs) &&
        Number.isFinite(alignedByIndex.get(i)?.endMs) &&
        alignedByIndex.get(i).startMs >= 0 &&
        alignedByIndex.get(i).endMs <= report.durationMs &&
        alignedByIndex.get(i).endMs > alignedByIndex.get(i).startMs),
  );
  report.passed =
    originalRows.length > 0 &&
    report.wholeSongTimed &&
    report.sourceTimesPreserved &&
    report.originalsPreserved &&
    !report.alerts.length &&
    !report.errors.length &&
    !report.audio.errors.length &&
    !report.audio.adChunks;
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
