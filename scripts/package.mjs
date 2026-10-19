import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
async function entries(dir, base = "") {
  const files = {};
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const rel = path.posix.join(base, e.name);
    if (e.isDirectory())
      Object.assign(files, await entries(path.join(dir, e.name), rel));
    else files[rel] = new Uint8Array(await readFile(path.join(dir, e.name)));
  }
  return files;
}
const files = await entries("dist");
if (!files["manifest.json"] || !files["content.js"] || !files["background.js"])
  throw new Error("先執行 build");
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/ai-lyrics-extension.zip",
  zipSync(files, { level: 6 }),
);
console.log("Packaged artifacts/ai-lyrics-extension.zip");
