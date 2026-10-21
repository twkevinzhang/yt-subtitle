import { build } from "vite";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  cp,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

process.chdir(path.dirname(fileURLToPath(import.meta.url)));
const model = JSON.parse(
  await readFile("src/acoustic/model-manifest.json", "utf8"),
);
const cache = path.join(".model-cache", model.model, model.revision);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Prepare verified assets before Vite clears dist. Rebuilds reuse this cache,
// and the extension can load the packaged model without a network connection.
const deadline = AbortSignal.timeout(10 * 60_000);
for (const file of model.files) {
  const cached = path.join(cache, file);
  let bytes = await readFile(cached).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (!bytes || digest(bytes) !== model.sha256[file]) {
    console.log(`下載固定版本模型：${file}`);
    const response = await fetch(
      `https://huggingface.co/${model.model}/resolve/${model.revision}/${file}`,
      { signal: AbortSignal.any([deadline, AbortSignal.timeout(120_000)]) },
    );
    if (!response.ok)
      throw new Error(`模型下載失敗：${file} HTTP ${response.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 64 * 1024 * 1024)
        throw new Error(`模型檔超過 64 MiB：${file}`);
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
    if (digest(bytes) !== model.sha256[file])
      throw new Error(`模型 SHA-256 不符：${file}`);
    await mkdir(path.dirname(cached), { recursive: true });
    await writeFile(cached, bytes);
  }
}

const common = { configFile: false, logLevel: "warn", publicDir: false };
await build({
  ...common,
  build: {
    target: "chrome116",
    outDir: "dist",
    rollupOptions: { input: "options.html" },
  },
});
for (const [name, entry] of Object.entries({
  background: "src/background/index.ts",
  content: "src/content/index.ts",
  bridge: "src/youtube/bridge.ts",
  "audio-helper": "src/youtube/audio-helper.ts",
})) {
  await build({
    ...common,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      target: "chrome116",
      outDir: "dist",
      emptyOutDir: false,
      lib: {
        entry,
        formats: ["iife"],
        name: `AILyrics_${name.replaceAll("-", "_")}`,
        fileName: () => `${name}.js`,
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
}
for (const name of [
  "offscreen",
  "model-worker",
  "progressive-decoder",
  "lyric-locator",
  "progressive-audio-source",
]) {
  await build({
    ...common,
    build: {
      target: "chrome116",
      outDir: "dist/acoustic",
      emptyOutDir: false,
      lib: {
        entry: `src/acoustic/${name}.ts`,
        formats: ["es"],
        fileName: () => `${name}.js`,
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
}

const copies = {
  "extension/manifest.json": "manifest.json",
  "offscreen.html": "offscreen.html",
  "node_modules/kuromoji/build/kuromoji.js": "vendor/kuromoji.js",
  "node_modules/kuromoji/dict": "vendor/kuromoji-dict",
  "node_modules/kuromoji/LICENSE-2.0.txt": "vendor/KUROMOJI-LICENSE.txt",
  "node_modules/kuromoji/NOTICE.md": "vendor/KUROMOJI-NOTICE.md",
  "node_modules/@huggingface/transformers/LICENSE":
    "vendor/TRANSFORMERS-LICENSE.txt",
  "extension/licenses/ONNXRUNTIME-LICENSE.txt":
    "vendor/ONNXRUNTIME-LICENSE.txt",
};
for (const file of [
  "transformers.min.js",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
]) {
  copies[`node_modules/@huggingface/transformers/dist/${file}`] =
    `vendor/${file}`;
}
for (const [source, destination] of Object.entries(copies)) {
  const target = path.join("dist", destination);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
}
// Copy only pinned files; stray cache files never enter the distribution.
for (const file of model.files) {
  const target = path.join("dist/models", model.model, file);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(cache, file), target);
}
console.log(
  `建置完成：dist/（含 ${model.files.length} 個已校驗的 Whisper 模型檔）`,
);

if (process.argv.includes("--package")) {
  async function entries(dir, base = "") {
    const files = {};
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = path.posix.join(base, entry.name);
      const full = path.join(dir, entry.name);
      if (entry.isDirectory())
        Object.assign(files, await entries(full, relative));
      else files[relative] = new Uint8Array(await readFile(full));
    }
    return files;
  }
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/ai-lyrics-extension.zip",
    zipSync(await entries("dist"), { level: 6 }),
  );
  console.log("打包完成：artifacts/ai-lyrics-extension.zip");
}
