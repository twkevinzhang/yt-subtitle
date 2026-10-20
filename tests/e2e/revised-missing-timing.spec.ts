import { test, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extensionTest, watchFixture } from "./support/extension";
test("Brave: pasted partial times through progressive codec, background upload and real WASM (fixture transport)", async () => {
  test.setTimeout(180000);
  const app = await extensionTest(true);
  let helpers = 0;
  try {
    const options = await app.context.newPage();
    await options.goto(app.optionsUrl);
    const bytes = await options.evaluate(
      async (base64) => {
        const ctx = new AudioContext({ sampleRate: 48000 }),
          decoded = await ctx.decodeAudioData(
            Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer,
          );
        const padded = ctx.createBuffer(1, Math.ceil(12.5 * 48000), 48000);
        padded.copyToChannel(decoded.getChannelData(0), 0);
        const source = ctx.createBufferSource(),
          dest = ctx.createMediaStreamDestination();
        source.buffer = padded;
        source.connect(dest);
        const rec = new MediaRecorder(dest.stream, {
            mimeType: "audio/webm;codecs=opus",
          }),
          chunks: Blob[] = [];
        const result = new Promise<string>((resolve, reject) => {
          rec.ondataavailable = (e) => chunks.push(e.data);
          rec.onerror = reject;
          rec.onstop = async () => {
            const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
            let text = "";
            for (const b of bytes) text += String.fromCharCode(b);
            resolve(btoa(text));
          };
        });
        source.onended = () => rec.stop();
        await ctx.resume();
        rec.start();
        source.start();
        try {
          return await result;
        } finally {
          dest.stream.getTracks().forEach((t) => t.stop());
          await ctx.close();
        }
      },
      (await readFile("artifacts/browser-probe/jfk.wav")).toString("base64"),
    );
    await app.context.route("https://www.youtube.com/watch*", async (route) => {
      const nonce = new URL(route.request().url()).searchParams.get(
        "ai-lyrics-audio",
      );
      if (nonce) {
        helpers++;
        await route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><script>let sent=false;addEventListener('message',e=>{if(e.data.action!=='range'||sent)return;sent=true;const bytes=Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0));let sequence=0;for(let at=0;at<bytes.length;at+=8192){const seq=sequence++;parent.postMessage({tag:'ai-lyrics-audio',nonce:${JSON.stringify(nonce)},type:'chunk',generation:0,sequence:seq,init:seq===0,mime:'audio/webm;codecs=opus',data:bytes.slice(at,at+8192).buffer},'https://www.youtube.com');}});</script>`,
        });
        return;
      }
      await route.fulfill({
        contentType: "text/html",
        body: (await watchFixture())
          .replace("lengthSeconds:'10'", "lengthSeconds:'12'")
          .replace("value:10", "value:12"),
      });
    });
    const page = await app.context.newPage();
    await page.goto("https://www.youtube.com/watch?v=12345678901");
    await page.getByRole("button", { name: "AI 歌詞", exact: true }).click();
    await page.getByRole("button", { name: "貼入字幕", exact: true }).click();
    const text =
      "And so my fellow Americans ask not what your country can do for you ask what you can do for your country";
    await page
      .getByLabel("字幕全文")
      .fill(`[00:00.000]source stays\n[00:00.100]${text}`);
    await page
      .getByRole("button", { name: "使用貼入字幕", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "套用並保存", exact: true }),
    ).toBeEnabled({ timeout: 120000 });
    expect(helpers).toBe(1);
    await expect(page.getByLabel("第 1 句開始秒數")).toHaveValue("0");
    await expect(page.getByLabel("第 1 句結束秒數")).toHaveValue("0.1");
    await expect(page.getByLabel("第 2 句開始秒數")).toHaveValue("0.1");
    expect(
      Number(await page.getByLabel("第 2 句結束秒數").inputValue()),
    ).toBeGreaterThan(1);
    await page.getByRole("button", { name: "套用並保存", exact: true }).click();
    await expect(
      page.getByText("已套用並保存至本機。", { exact: true }),
    ).toBeVisible();
    await expect(page.locator('iframe[src*="ai-lyrics-audio"]')).toHaveCount(0);
    await mkdir("artifacts/progressive-alignment", { recursive: true });
    await writeFile(
      "artifacts/progressive-alignment/partial-native.json",
      JSON.stringify(
        {
          kind: "real native codec + local WASM; fixture YouTube transport, no AI",
          helpers,
          firstEnd: await page.getByLabel("第 1 句結束秒數").inputValue(),
          secondEnd: await page.getByLabel("第 2 句結束秒數").inputValue(),
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
});
