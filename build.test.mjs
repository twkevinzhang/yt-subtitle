import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { unzipSync } from "fflate";
test("正式 manifest 的入口都已建置且不再注入播放器擷取器", async () => {
  const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
  for (const entry of [
    manifest.background.service_worker,
    manifest.options_page,
    ...manifest.content_scripts.flatMap((c) => c.js),
    "bridge.js",
  ])
    await access("dist/" + entry);
  assert.equal(
    manifest.content_scripts.some((c) => c.js.includes("audio-helper.js")),
    false,
  );
  assert.equal(
    manifest.host_permissions.some((p) => p.includes("po-token")),
    false,
  );
});
test("ZIP 與正式 manifest 一致且沒有舊模型或推論引擎", async () => {
  const files = unzipSync(await readFile("artifacts/ai-lyrics-extension.zip"));
  assert.deepEqual(
    files["manifest.json"],
    new Uint8Array(await readFile("extension/manifest.json")),
  );
  assert.ok(files["background.js"]);
  assert.ok(files["content.js"]);
  assert.equal(
    Object.keys(files).some((file) => /^(models|acoustic)\//u.test(file)),
    false,
  );
  assert.ok(files["subtitle-host.html"]);
  assert.ok(files["vendor/lyric-align-ts/index.js"]);
  assert.ok(
    Object.keys(files).some((file) =>
      /^vendor\/lyric-align-ts\/assets\/worker-.*\.js$/.test(file),
    ),
  );
  assert.ok(files["vendor/lyric-align-ts/upstream.LICENSE"]);
  assert.equal(
    Object.keys(files).some((file) => /audio-helper|model-worker/u.test(file)),
    false,
  );
});
