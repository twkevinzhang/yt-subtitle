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
        name: `AILyrics_${name}`,
        fileName: () => `${name}.js`,
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
}
await mkdir("dist", { recursive: true });
await copyFile("extension/manifest.json", "dist/manifest.json");
const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
for (const file of [
  manifest.background.service_worker,
  manifest.options_page,
  ...manifest.content_scripts.flatMap((x) => x.js),
  "bridge.js",
])
  await readFile(path.join("dist", file));
console.log("Extension built: dist/");
