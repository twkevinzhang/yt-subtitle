import { createServer } from "node:http";
import { Readable } from "node:stream";
import { createApp } from "./app.js";
import { createTokenProvider } from "./token-provider.js";
import { readConfig } from "./config.js";
import { authorizeIamRequest } from "./auth.js";
const config = readConfig();
const provider = createTokenProvider();
const app = createApp({
  generate: provider.generate,
  authorize: authorizeIamRequest,
  deadlineMs: config.deadlineMs,
});
const server = createServer(async (req, res) => {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  const body =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : Readable.toWeb(req);
  const request = new Request(`http://container${req.url}`, {
    method: req.method,
    headers: req.headers as HeadersInit,
    signal: controller.signal,
    ...(body
      ? { body: body as ReadableStream<Uint8Array>, duplex: "half" }
      : {}),
  });
  try {
    const response = await app(request);
    if (!res.destroyed) {
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    }
  } catch {
    if (!res.destroyed) {
      res.writeHead(500);
      res.end();
    }
  }
});
server.requestTimeout = 25_000;
server.headersTimeout = 10_000;
server.listen(config.port, "0.0.0.0", () =>
  console.log(JSON.stringify({ event: "listening", port: config.port })),
);
process.on("SIGTERM", () => {
  server.close();
  setTimeout(() => process.exit(0), 22_000).unref();
});
