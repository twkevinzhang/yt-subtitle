import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";

const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const model = await json("src/acoustic/model-manifest.json");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("建置入口存在，且擴充功能包含所有執行入口與離線模型", async () => {
  const pkg = await json("package.json");
  await access(pkg.scripts.build.split(" ")[1]);
  const manifest = await json("dist/manifest.json");
  const entries = [
    manifest.background.service_worker,
    manifest.options_page,
    ...manifest.content_scripts.flatMap((entry) => entry.js),
    "bridge.js",
    "offscreen.html",
    ...[
      "offscreen",
      "model-worker",
      "progressive-decoder",
      "lyric-locator",
      "progressive-audio-source",
    ].map((name) => `acoustic/${name}.js`),
    "vendor/transformers.min.js",
    "vendor/ort-wasm-simd-threaded.jsep.mjs",
    "vendor/ort-wasm-simd-threaded.jsep.wasm",
    "vendor/kuromoji.js",
    "vendor/kuromoji-dict/base.dat.gz",
  ];
  for (const file of entries) await access(`dist/${file}`);
  for (const file of model.files) {
    const bytes = await readFile(`dist/models/${model.model}/${file}`);
    assert.equal(digest(bytes), model.sha256[file], file);
  }
});

test("安裝 ZIP 保留相同模型與正式 manifest", async () => {
  const files = unzipSync(await readFile("artifacts/ai-lyrics-extension.zip"));
  assert.deepEqual(
    files["manifest.json"],
    new Uint8Array(await readFile("extension/manifest.json")),
  );
  for (const file of model.files) {
    assert.ok(files[`models/${model.model}/${file}`], file);
    assert.equal(
      digest(files[`models/${model.model}/${file}`]),
      model.sha256[file],
      file,
    );
  }
});
