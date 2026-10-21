import { expect, it } from "vitest";
import { createTokenProvider } from "../src/token-provider.js";
import { execFileSync } from "node:child_process";
it("terminates a CPU-bound worker on cancellation", async () => {
  const provider = createTokenProvider({
    workerUrl: new URL("data:text/javascript,while(true){}"),
  });
  const signal = AbortSignal.timeout(80);
  await expect(provider.generate("e1ZMmRlsaaU", signal)).rejects.toThrow(
    /cancel/i,
  );
  expect(provider.activeWorkers()).toBe(0);
});
it("does not launch a worker when already cancelled", async () => {
  const provider = createTokenProvider();
  const c = new AbortController();
  c.abort();
  await expect(provider.generate("e1ZMmRlsaaU", c.signal)).rejects.toThrow(
    /cancel/i,
  );
  expect(provider.activeWorkers()).toBe(0);
});
it("does not inherit CLI flags that prevent file-backed workers from starting", () => {
  const code = `import {createTokenProvider} from './src/token-provider.ts';const p=createTokenProvider({workerUrl:new URL('./tests/fixtures/worker-success.mjs',import.meta.url)});const r=await p.generate('e1ZMmRlsaaU',AbortSignal.timeout(1000));console.log(r.poToken);`;
  expect(
    execFileSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: new URL("..", import.meta.url),
      timeout: 3000,
      encoding: "utf8",
    }).trim(),
  ).toBe("dGVzdA");
});
