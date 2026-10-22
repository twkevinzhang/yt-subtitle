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
await cp("extension/manifest.json", "dist/manifest.json");
console.log("建置完成：dist/（無內建語音模型；library 邊界尚待接入）");

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
