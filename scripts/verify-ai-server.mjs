// Credentials arrive on stdin. Never save or print them.
// This calls the existing server once using the actual built extension prompt.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import ts from "typescript";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const config = JSON.parse(input);
const secrets = [
  config.apiToken,
  config.cfClientId,
  config.cfClientSecret,
].filter(Boolean);
const redact = (text) =>
  secrets.reduce(
    (value, secret) => value.replaceAll(secret, "[REDACTED]"),
    String(text),
  );
const label = process.argv[2] ?? "yt-base";
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error("Invalid report label");
const folder = `artifacts/ai-server-verification/${label}`;
await mkdir(folder, { recursive: true });
function promptFrom(code, name) {
  const tree = ts.createSourceFile(
    name,
    code,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  const found = new Set();
  const visit = (node) => {
    if (
      ts.isStringLiteralLike(node) &&
      node.text.includes("完整 YT 字幕是輸出底稿")
    )
      found.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (found.size !== 1)
    throw new Error(
      `${name}: expected one built system prompt, got ${found.size}`,
    );
  return [...found][0];
}
const bundle = await readFile("dist/background.js", "utf8");
const contentBundle = await readFile("dist/content.js", "utf8");
const system = promptFrom(bundle, "background.js");
if (promptFrom(contentBundle, "content.js") !== system)
  throw new Error("Built prompts differ");
const fixture = JSON.parse(
  await readFile("tests/fixtures/reported-song-request.json", "utf8"),
);
const body = {
  model: config.model ?? fixture.model,
  stream: false,
  messages: [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify(fixture.data) },
  ],
};
await writeFile(`${folder}/request.json`, JSON.stringify(body, null, 2));
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const startedAt = new Date().toISOString();
const start = performance.now();
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 120000);
let summary = {
  startedAt,
  model: body.model,
  bundleSha256: sha256(bundle),
  systemSha256: sha256(system),
  lyrics: fixture.data.lyrics.length,
  cues: fixture.data.cues.length,
};
try {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiToken}`,
  };
  if (config.cfClientId && config.cfClientSecret) {
    headers["CF-Access-Client-Id"] = config.cfClientId;
    headers["CF-Access-Client-Secret"] = config.cfClientSecret;
  }
  const response = await fetch(
    `${config.baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "error",
    },
  );
  summary.httpStatus = response.status;
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) {
      controller.abort();
      throw new Error("Response exceeds 4 MiB");
    }
    chunks.push(chunk);
  }
  const raw = redact(Buffer.concat(chunks).toString("utf8"));
  await writeFile(`${folder}/response.json`, raw);
  if (!response.ok)
    throw new Error(`HTTP ${response.status}; response retained locally`);
  const envelope = JSON.parse(raw);
  const content = envelope.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("No assistant text");
  await writeFile(`${folder}/assistant.txt`, content);
  const revised = JSON.parse(
    content.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""),
  );
  const lines = revised.lines;
  if (!Array.isArray(lines)) throw new Error("No subtitle lines array");
  const timed = lines.filter(
    (l) => Number.isFinite(l.startMs) && Number.isFinite(l.endMs),
  );
  const groups = new Map();
  for (const [i, l] of lines.entries()) {
    if (
      Number.isFinite(l.startMs) &&
      Number.isFinite(l.endMs) &&
      !l.simultaneous
    ) {
      const key = `${l.startMs}:${l.endMs}`;
      groups.set(key, [...(groups.get(key) ?? []), i]);
    }
  }
  const text = lines
    .map((l) => l.text ?? "")
    .join("")
    .replace(/\s/g, "");
  summary = {
    ...summary,
    elapsedMs: Math.round(performance.now() - start),
    finishReason: envelope.choices?.[0]?.finish_reason,
    usage: envelope.usage,
    lineCount: lines.length,
    timedCount: timed.length,
    pendingCount: lines.length - timed.length,
    maxEndMs: Math.max(0, ...timed.map((l) => l.endMs)),
    multilineRows: lines.flatMap((l, i) =>
      /\n/.test(l.text ?? "") ? [i] : [],
    ),
    longRows: lines.flatMap((l, i) => ((l.text ?? "").length > 100 ? [i] : [])),
    sharedTimeGroups: [...groups.entries()].filter(([, ids]) => ids.length > 1),
    laterCueRows: lines.flatMap((l, i) =>
      (l.cueIds ?? []).some(
        (id) => /^t\d+$/.test(id) && Number(id.slice(1)) >= 23,
      )
        ? [i]
        : [],
    ),
    phraseChecks: Object.fromEntries(
      ["振り返れば", "少年時代", "最後に言えなかった"].map((p) => [
        p,
        text.includes(p),
      ]),
    ),
    outputSha256: sha256(content),
  };
  const rows = lines
    .map(
      (l, i) =>
        `${i}\t${l.startMs ?? "?"}\t${l.endMs ?? "?"}\t${(l.cueIds ?? []).join(",")}\t${String(l.text).replaceAll("\n", " ")}`,
    )
    .join("\n");
  await writeFile(`${folder}/rows.tsv`, rows);
} catch (error) {
  summary.error = redact(error instanceof Error ? error.message : error);
  summary.elapsedMs = Math.round(performance.now() - start);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await writeFile(`${folder}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}
