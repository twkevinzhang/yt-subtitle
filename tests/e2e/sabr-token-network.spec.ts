import { test, expect, chromium } from "@playwright/test";
import { build } from "vite";

for (const [name, executablePath] of [
  [
    "Brave",
    "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
  ],
  ["Chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"],
] as const) {
  test(`${name}: SABR network preserves native cancellation, send state and body snapshot`, async () => {
    const output = await build({
      configFile: false,
      logLevel: "silent",
      build: {
        write: false,
        minify: false,
        lib: { entry: "src/youtube/sabr-token-network.ts", formats: ["es"] },
      },
    });
    const bundle = Array.isArray(output) ? output[0] : output;
    if (!("output" in bundle)) throw Error("Unexpected build output");
    const chunk = bundle.output.find((item) => item.type === "chunk");
    if (!chunk || chunk.type !== "chunk") throw Error("Missing wrapper module");
    const browser = await chromium.launch({ executablePath, headless: true });
    const posts: number[][] = [];
    try {
      const context = await browser.newContext();
      // No server or external request: all resources are fulfilled in memory.
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin === "http://127.0.0.1:33000")
          return route.fulfill({
            contentType:
              url.pathname === "/wrapper.js" ? "text/javascript" : "text/html",
            body:
              url.pathname === "/wrapper.js"
                ? chunk.code
                : "<!doctype html><title>SABR lifecycle</title>",
          });
        if (url.href === "https://rr.example.googlevideo.com/videoplayback") {
          if (route.request().method() === "POST")
            posts.push([...route.request().postDataBuffer()!]);
          return route.fulfill({
            status: 200,
            headers: {
              "access-control-allow-origin": "*",
              "access-control-allow-methods": "POST",
              "access-control-allow-headers": "*",
            },
            body: "ok",
          });
        }
        return route.abort();
      });
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:33000/");
      const result = await page.evaluate(async () => {
        const { installSabrTokenNetwork } = await import(
          new URL("/wrapper.js", location.href).href
        );
        const url = "https://rr.example.googlevideo.com/videoplayback";
        const errors: string[] = [];
        let resolve!: (token: Uint8Array) => void;
        let notifyStarted!: () => void;
        let started = new Promise<void>((r) => {
          notifyStarted = r;
        });
        const stop = installSabrTokenNetwork(
          () => {
            notifyStarted();
            return new Promise<Uint8Array>((r) => {
              resolve = r;
            });
          },
          (message: string) => errors.push(message),
        );
        try {
          const storage = new Uint8Array([88, 154, 1, 5, 8, 1, 18, 1, 9, 99]);
          const xhr = new XMLHttpRequest();
          xhr.open("POST", url);
          const finished = new Promise<string>((r, reject) => {
            xhr.onload = () => r(xhr.responseText);
            xhr.onerror = () => reject(Error("XHR failed"));
          });
          xhr.send(storage.subarray(1, 9));
          let duplicateError = "";
          try {
            xhr.send(storage);
          } catch (error) {
            duplicateError = (error as DOMException).name;
          }
          storage[5] = 77;
          resolve(new Uint8Array([3]));
          const response = await finished;
          started = new Promise<void>((r) => {
            notifyStarted = r;
          });
          const c = new AbortController();
          let abortResult = "pending";
          const work = fetch(url, {
            method: "POST",
            body: new Uint8Array([154, 1, 3, 18, 1, 9]),
            signal: c.signal,
          }).then(
            () => {
              abortResult = "sent";
            },
            (error) => {
              abortResult = error.name;
            },
          );
          await started;
          c.abort();
          await new Promise((r) => setTimeout(r, 0));
          const immediateAbort = abortResult;
          // Release the shared provider promise after observing cancellation.
          resolve(new Uint8Array([3]));
          await work;
          return { duplicateError, response, immediateAbort, errors };
        } finally {
          stop();
        }
      });
      expect(result).toEqual({
        duplicateError: "InvalidStateError",
        response: "ok",
        immediateAbort: "AbortError",
        errors: [],
      });
      expect(posts).toEqual([[154, 1, 5, 8, 1, 18, 1, 3]]);
    } finally {
      await browser.close();
    }
  });
}
