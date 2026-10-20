// Local storage benchmark only: synthetic PCM is never subtitle timing evidence.
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

await mkdir("artifacts", { recursive: true });
const output = resolve("artifacts/benchmark-pcm-source-bundle.mjs");
await build({
  entryPoints: ["src/acoustic/progressive-audio-source.ts"],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "esm",
});
const { RangeAudioSource } = await import(pathToFileURL(output).href);
const audio = new RangeAudioSource(300000, () => {});
const controller = new AbortController();
const wanted = { startMs: 288000, endMs: 299961 };
const pending = audio.ensure(wanted, controller.signal).catch(() => {});
const started = performance.now();
let frames = 0;
try {
  for (; frames < 15000; frames++) {
    audio.append({
      generation: 0,
      startMs: frames * 20,
      sampleRate: 16000,
      pcm: new Float32Array(320),
    });
    audio
      .availableRanges()
      .some((r) => r.startMs <= wanted.startMs && r.endMs >= wanted.endMs);
    if (frames % 1000 === 999 && performance.now() - started > 15000) {
      frames++;
      process.exitCode = 1;
      break;
    }
  }
  console.log(
    JSON.stringify({
      frames,
      elapsedMs: Math.round(performance.now() - started),
      ...audio.stats(),
    }),
  );
} finally {
  controller.abort();
  await pending;
  audio.dispose();
}
