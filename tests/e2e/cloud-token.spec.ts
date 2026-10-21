import { test, expect, chromium } from "@playwright/test";
import { build } from "vite";
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readStreamProtectionStatus } from "../../src/youtube/sabr-protocol";

test("real MV3 cloud Token flow decodes consecutive windows past 60 seconds", async () => {
  test.skip(
    process.env.RUN_CLOUD_TOKEN_ACCEPTANCE !== "1",
    "External calls require explicit opt-in and current cost authorization",
  );
  test.setTimeout(115000);
  const approval = JSON.parse(
    await readFile(
      "artifacts/cloud-run/po-token/preflight/approval.json",
      "utf8",
    ),
  );
  const counterFile = "artifacts/cloud-run/po-token/remote-calls.json";
  const count = JSON.parse(await readFile(counterFile, "utf8")).count;
  expect(Date.parse(approval.expiresAt)).toBeGreaterThan(Date.now());
  expect(count).toBeLessThan(approval.maxTokenRequests);
  // Reserve one API call for this one video. Browser background caches its Token
  // across consecutive range requests; there is no Playwright network rewrite.
  await writeFile(
    counterFile,
    JSON.stringify({
      count: count + 1,
      at: new Date().toISOString(),
      deadline: approval.expiresAt,
    }),
  );
  const root = await mkdtemp(path.join(os.tmpdir(), "yt-token-acceptance-"));
  const ext = path.join(root, "extension");
  let context:
    Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const report: {
    apiRequests: number;
    statuses: number[];
    ranges: unknown[];
    errors: string[];
  } = { apiRequests: 0, statuses: [], ranges: [], errors: [] };
  const pending: Promise<void>[] = [];
  try {
    await cp("dist", ext, { recursive: true });
    const entry = path.join(root, "probe.ts");
    await writeFile(
      entry,
      `import {createProgressiveAudioSource} from ${JSON.stringify(path.resolve("src/acoustic/youtube-stream.ts"))};
if(parent===window){
 const button=document.createElement('button');button.id='cloud-token-probe';button.textContent='Cloud Token acceptance';button.style.cssText='position:fixed;top:0;left:0;z-index:2147483647';
 button.onclick=async()=>{const rows=[];const show=r=>{rows.push(r);document.documentElement.dataset.cloudProbe=JSON.stringify(rows);console.log('cloud-token-probe:'+JSON.stringify(r));};
 const source=createProgressiveAudioSource({runId:crypto.randomUUID(),tabId:1,videoId:'e1ZMmRlsaaU',draftRevision:1},299961,t=>show({notice:t}));const c=new AbortController();const timer=setTimeout(()=>c.abort(),85000);
 try{for(const [startMs,endMs]of [[0,26000],[24000,50000],[48000,74000],[72000,98000]]){await source.ensure({startMs,endMs},c.signal);const range=source.readableRange({startMs,endMs});const {pcm}=await source.read(range.startMs,range.endMs);show({ready:range,samples:pcm.length,rms:Math.sqrt(pcm.reduce((n,x)=>n+x*x,0)/pcm.length)});}show({complete:true});}catch(e){show({error:String(e)});}finally{clearTimeout(timer);source.dispose();show({finished:true});}};
 document.documentElement.append(button);
}`,
    );
    await build({
      configFile: false,
      logLevel: "silent",
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      build: {
        outDir: ext,
        emptyOutDir: false,
        minify: false,
        lib: {
          entry,
          formats: ["iife"],
          name: "CloudTokenAcceptance",
          fileName: () => "content.js",
        },
      },
    });
    context = await chromium.launchPersistentContext(
      path.join(root, "profile"),
      {
        executablePath:
          "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
        headless: true,
        ignoreDefaultArgs: ["--disable-extensions"],
        args: [
          `--disable-extensions-except=${ext}`,
          `--load-extension=${ext}`,
          "--autoplay-policy=no-user-gesture-required",
        ],
      },
    );
    timer = setTimeout(() => void context?.close(), 100000);
    context.on("request", (r) => {
      if (
        r
          .url()
          .startsWith(
            "https://po-token.example.invalid/v1/po-token",
          )
      )
        report.apiRequests++;
    });
    context.on("response", (r) => {
      const u = new URL(r.url());
      if (
        u.hostname.endsWith(".googlevideo.com") &&
        u.pathname === "/videoplayback" &&
        r.request().frame().parentFrame()
      )
        pending.push(
          (async () => {
            try {
              const status = readStreamProtectionStatus(
                new Uint8Array(await r.body()),
              );
              if (status) report.statuses.push(status);
            } catch {}
          })(),
        );
    });
    context.on("console", (m) => {
      if (m.text().startsWith("cloud-token-probe:")) {
        const row = JSON.parse(m.text().slice(18));
        if (row.ready) report.ranges.push(row);
        if (row.error) report.errors.push(row.error);
      }
    });
    const page = await context.newPage();
    await page.goto("https://www.youtube.com/watch?v=e1ZMmRlsaaU", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    await page.locator("video").first().waitFor({ timeout: 10000 });
    await page.evaluate(() => {
      const video = document.querySelector("video")!;
      video.muted = true;
      video.pause();
    });
    await page.locator("#cloud-token-probe").click();
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.cloudProbe?.includes(
          '"finished":true',
        ),
      undefined,
      { timeout: 90000 },
    );
    await Promise.race([
      Promise.allSettled(pending),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    expect(report.errors).toEqual([]);
    expect(report.ranges).toHaveLength(4);
    expect(report.ranges.every((r: any) => r.samples > 0 && r.rms > 0.01)).toBe(
      true,
    );
    expect(report.statuses).toContain(1);
    expect(report.statuses).not.toContain(3);
    expect(report.apiRequests).toBe(1);
  } finally {
    clearTimeout(timer);
    await context?.close();
    await mkdir("artifacts/cloud-run/po-token", { recursive: true });
    await writeFile(
      "artifacts/cloud-run/po-token/mv3-acceptance.json",
      JSON.stringify(report, null, 2),
    );
    if (
      path.dirname(root) !== os.tmpdir() ||
      !path.basename(root).startsWith("yt-token-acceptance-")
    )
      throw Error("unsafe cleanup path");
    await rm(root, { recursive: true, force: true });
  }
});
