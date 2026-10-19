// Recheck a real server reply with the product's parser and SRT exporter.
// This script makes no network request and accepts no credentials.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const label = process.argv[2];
if (!label || !/^[a-z0-9-]+$/i.test(label))
  throw new Error("Supply a report label");
const folder = `artifacts/ai-server-verification/${label}`;
const require = createRequire(import.meta.url);
function moduleUrl(source, replacements = {}) {
  let code = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  for (const [from, to] of Object.entries(replacements))
    code = code.replaceAll(
      `from ${JSON.stringify(from)}`,
      `from ${JSON.stringify(to)}`,
    );
  return "data:text/javascript;base64," + Buffer.from(code).toString("base64");
}
const formatUrl = moduleUrl(await readFile("src/lyrics/formats.ts", "utf8"));
const { parseLyrics, validateTiming } = await import(formatUrl);
const { toSrt } = await import(
  moduleUrl(await readFile("src/lyrics/export.ts", "utf8"), {
    "./formats": formatUrl,
  })
);
const { parseRevisedSubtitles } = await import(
  moduleUrl(await readFile("src/lyrics/revised-subtitles.ts", "utf8"), {
    zod: pathToFileURL(require.resolve("zod")).href,
  })
);
const request = JSON.parse(await readFile(`${folder}/request.json`, "utf8"));
const input = JSON.parse(request.messages[1].content);
const durationMs = Math.max(...input.cues.map((c) => c.endMs));
const envelope = JSON.parse(await readFile(`${folder}/response.json`, "utf8"));
const text = envelope.choices[0].message.content
  .replace(/^\s*```(?:json)?\s*/, "")
  .replace(/\s*```\s*$/, "");
let report = { model: envelope.model, durationMs, validationPassed: false };
try {
  const lines = parseRevisedSubtitles(JSON.parse(text), durationMs);
  const issues = validateTiming(lines, durationMs, 0);
  const pending = lines.filter(
    (l) => l.startMs === undefined || l.endMs === undefined,
  );
  report = {
    ...report,
    lineCount: lines.length,
    pendingCount: pending.length,
    estimatedCount: lines.filter((l) => l.status === "estimated").length,
    issues,
  };
  const srt = toSrt(lines, "original", 0, durationMs);
  const roundtrip = parseLyrics(
    new TextEncoder().encode(srt),
    "srt",
    durationMs,
  );
  if (
    roundtrip.length !== lines.length ||
    roundtrip.some((l, i) => l.original !== lines[i].original)
  )
    throw new Error("SRT round trip loses subtitle text");
  const corpus = lines
    .map((l) => l.original)
    .join("")
    .replace(/\s/g, "");
  const phraseChecks = Object.fromEntries(
    ["振り返れば", "少年時代", "最後に言えなかった"].map((p) => [
      p,
      corpus.includes(p),
    ]),
  );
  if (Object.values(phraseChecks).some((v) => !v))
    throw new Error("Known later verse is missing");
  await writeFile(`${folder}/SUNEO-ISM.complete.srt`, srt);
  await writeFile(
    `${folder}/client-lines.json`,
    JSON.stringify(lines, null, 2),
  );
  const normalize = (s) =>
    s
      .normalize("NFKC")
      .replace(/[\s\p{P}\p{S}]/gu, "")
      .toLowerCase();
  const fullText = normalize(
    lines.map((l) => l.original + (l.translation ?? "")).join(""),
  );
  const missingInputIndices = input.lyrics.flatMap((l, i) =>
    fullText.includes(normalize(l.text)) ? [] : [i],
  );
  const cited = new Set(lines.flatMap((l) => l.cueIds));
  const uncitedLexicalCueIds = input.cues
    .filter(
      (c) =>
        c.text.replace(/\[[^\]]*\]|\s|[。、，,.!?。]/g, "").length > 0 &&
        !cited.has(c.id),
    )
    .map((c) => c.id);
  const contentPassed =
    missingInputIndices.length === 0 && uncitedLexicalCueIds.length === 0;
  report = {
    ...report,
    phraseChecks,
    roundtripCount: roundtrip.length,
    srtBytes: Buffer.byteLength(srt),
    lastEndMs: Math.max(...lines.map((l) => l.endMs)),
    exportPassed: true,
    missingInputIndices,
    uncitedLexicalCueIds,
    translationCount: lines.filter((l) => !!l.translation).length,
    contentPassed,
    validationPassed: contentPassed,
  };
  if (!contentPassed) {
    report.error =
      "SRT exported, but supplied content or lyric cues are missing";
    process.exitCode = 1;
  }
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
}
await writeFile(
  `${folder}/srt-validation.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
