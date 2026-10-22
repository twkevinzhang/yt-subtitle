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
import { zipSync, unzipSync } from "fflate";

process.chdir(path.dirname(fileURLToPath(import.meta.url)));
const common = { configFile: false, logLevel: "warn", publicDir: false };
await build({
  ...common,
  build: {
    target: "chrome116",
    outDir: "dist",
    rollupOptions: { input: ["options.html", "subtitle-host.html"] },
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
const release = await readFile("vendor/lyric-align-ts/release.zip");
if (
  createHash("sha256").update(release).digest("hex") !==
  "c7a6c80b461891a23924328d6949063fd593f09fdb49521b6923df8678557fa9"
)
  throw Error("lyric-align-ts release checksum mismatch");
for (const [archiveName, bytes] of Object.entries(unzipSync(release))) {
  if (!archiveName.startsWith("library/"))
    throw Error("Unexpected release root");
  const name = archiveName.slice("library/".length);
  if (name.endsWith("/") || name.endsWith(".map")) continue;
  if (name.startsWith("/") || name.split("/").includes(".."))
    throw Error("Unsafe release path");
  const target = path.join("dist/vendor/lyric-align-ts", name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}
console.log("建置完成：dist/（lyric-align-ts 0.1.0；模型按需下載）");

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
