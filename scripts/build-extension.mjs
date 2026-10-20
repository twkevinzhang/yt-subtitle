import { build } from "vite";
import { mkdir, copyFile, readFile } from "node:fs/promises";
import path from "node:path";
await build({
  configFile: false,
  logLevel: "warn",
  build: {
    target: "chrome102",
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
    configFile: false,
    logLevel: "warn",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      target: "chrome102",
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
await mkdir("dist", { recursive: true });
await copyFile("extension/manifest.json", "dist/manifest.json");
await copyFile("offscreen.html", "dist/offscreen.html");
for (const name of [
  "offscreen",
  "model-worker",
  "progressive-decoder",
  "lyric-locator",
  "progressive-audio-source",
]) {
  await build({
    configFile: false,
    logLevel: "warn",
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
await mkdir("dist/vendor", { recursive: true });
for (const file of [
  "transformers.min.js",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
]) {
  await copyFile(
    `node_modules/@huggingface/transformers/dist/${file}`,
    `dist/vendor/${file}`,
  );
}
await copyFile(
  "node_modules/@huggingface/transformers/LICENSE",
  "dist/vendor/TRANSFORMERS-LICENSE.txt",
);
await copyFile(
  "extension/licenses/ONNXRUNTIME-LICENSE.txt",
  "dist/vendor/ONNXRUNTIME-LICENSE.txt",
);
const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
for (const file of [
  manifest.background.service_worker,
  manifest.options_page,
  ...manifest.content_scripts.flatMap((x) => x.js),
  "bridge.js",
  "offscreen.html",
  "acoustic/offscreen.js",
  "acoustic/model-worker.js",
])
  await readFile(path.join("dist", file));
console.log("Extension built: dist/");
