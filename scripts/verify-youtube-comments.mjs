import { readFile, writeFile, mkdir } from "node:fs/promises";
import ts from "typescript";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
await mkdir("artifacts/comments-native", { recursive: true });
await writeFile(
  "artifacts/comments-native/support.mjs",
  ts.transpileModule(await readFile("tests/e2e/support/extension.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
);
const { extensionTest } =
  await import("../artifacts/comments-native/support.mjs");
const lines = (await readFile("ai-server.payload", "utf8"))
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean),
  provider = {};
for (let i = 0; i < lines.length; i++)
  for (const [label, key] of [
    ["API Base URL", "baseUrl"],
    ["API Token", "apiToken"],
    ["Cloudflare Client ID", "cfClientId"],
    ["Cloudflare Client Secret", "cfClientSecret"],
  ])
    if (lines[i].replace(/[:：]\s*$/, "").toLowerCase() === label.toLowerCase())
      provider[key] = lines[i + 1];
if (!provider.apiToken) throw Error("Missing payload");
let realCalls = 0,
  requestBody,
  rawEnvelope,
  upstream;
const report = {
  startedAt: new Date().toISOString(),
  videoId: "e1ZMmRlsaaU",
  model: "gpt-6-luna",
  maxRealRequests: 1,
  timeoutMs: 120000,
  retries: 0,
  cost: "existing subscription quota only; no incremental metered fees",
  webRoute: "local stub, outside this validation",
  passed: false,
};
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  try {
    let raw = "";
    for await (const c of req) raw += c;
    if (!raw) {
      res.end(JSON.stringify({ data: [{ id: "gpt-6-luna" }] }));
      return;
    }
    const body = JSON.parse(raw);
    if (req.url != "/v1/chat/completions") {
      res.end(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: '{"candidates":[],"error":"本次只驗證留言路徑"}',
                },
              ],
            },
          ],
        }),
      );
      return;
    }
    if (realCalls++) throw Error("Single request limit");
    requestBody = body;
    await writeFile(
      "artifacts/comments-native/request.json",
      JSON.stringify(body, null, 2),
    );
    const data = JSON.parse(body.messages[1].content);
    if (
      !data.comments.some(
        (c) => c.pinned && c.id === "Ugyb3wEHXCMuObiD73R4AaABAg",
      )
    )
      throw Error("Actual pinned comment not captured");
    upstream = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) upstream.abort();
    });
    const timer = setTimeout(() => upstream.abort(), 120000);
    const start = Date.now();
    try {
      const response = await fetch(
        provider.baseUrl.replace(/\/$/, "") + "/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + provider.apiToken,
            "CF-Access-Client-Id": provider.cfClientId,
            "CF-Access-Client-Secret": provider.cfClientSecret,
          },
          body: raw,
          redirect: "error",
          signal: upstream.signal,
        },
      );
      const text = await response.text();
      rawEnvelope = JSON.parse(text);
      report.aiMs = Date.now() - start;
      report.httpStatus = response.status;
      await writeFile("artifacts/comments-native/response.json", text);
      res.statusCode = response.status;
      res.end(text);
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: { message: e.message } }));
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const app = await extensionTest(true);
const deadline = setTimeout(() => {
  upstream?.abort();
  void app.context.close();
}, 180000);
try {
  await app.worker.evaluate(
    async (baseUrl) =>
      chrome.storage.local.set({
        settings: {
          provider: {
            schemaVersion: 1,
            baseUrl,
            apiToken: "local-test-token",
            model: "gpt-6-luna",
          },
          sources: [],
          preferences: {
            mode: "original",
            targetLanguage: "ja",
            fontSize: 28,
            position: "bottom",
            alignmentMode: "background",
          },
          revision: 1,
        },
      }),
    `http://127.0.0.1:${server.address().port}/v1`,
  );
  const page = await app.context.newPage();
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = async () => {};
  });
  await page.goto("https://www.youtube.com/watch?v=e1ZMmRlsaaU", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page
    .getByRole("button", { name: "AI 歌詞", exact: true })
    .click({ timeout: 20000 });
  await page
    .getByRole("button", { name: "AI 找字幕", exact: true })
    .click({ timeout: 15000 });
  const group = page.getByRole("region", {
    name: "YouTube 留言區",
    exact: true,
  });
  await group
    .getByRole("button", { name: "使用這個版本", exact: true })
    .first()
    .waitFor({ timeout: 125000 });
  report.commentSource = await group
    .locator('a[href*="lc="]')
    .first()
    .getAttribute("href");
  if (!report.commentSource.includes("lc=Ugyb3wEHXCMuObiD73R4AaABAg"))
    throw Error("AI did not select pinned comment");
  report.groupText = (await group.innerText()).slice(0, 600);
  await page.screenshot({
    path: "artifacts/comments-native/real-candidate.png",
    fullPage: true,
  });
  await group
    .getByRole("button", { name: "使用這個版本", exact: true })
    .first()
    .click();
  await page
    .getByRole("heading", { name: "逐句預覽與校時", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "取消補時", exact: true })
    .click({ timeout: 10000 });
  report.adoptedRows = await page
    .getByRole("textbox", { name: "原文", exact: true })
    .count();
  report.adoptedChars = await page
    .getByRole("textbox", { name: "原文", exact: true })
    .evaluateAll((rows) => rows.reduce((n, r) => n + r.value.length, 0));
  if (report.adoptedRows < 30 || report.adoptedChars < 1000)
    throw Error("Selected lyrics not adopted completely");
  const data = JSON.parse(requestBody.messages[1].content),
    pin = data.comments.find(
      (c) => c.pinned && c.id === "Ugyb3wEHXCMuObiD73R4AaABAg",
    );
  report.pinned = {
    id: pin.id,
    author: pin.author,
    chars: pin.text.length,
    sha256: createHash("sha256").update(pin.text).digest("hex"),
  };
  report.commentsRead = data.comments.length;
  report.realCalls = realCalls;
  report.usage = rawEnvelope.usage;
  report.browserVersion = app.context.browser()?.version();
  report.passed = true;
  await page.screenshot({
    path: "artifacts/comments-native/real-adopted.png",
    fullPage: true,
  });
} catch (e) {
  report.error = e.message;
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  upstream?.abort();
  await app.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await writeFile(
    "artifacts/comments-native/result.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
