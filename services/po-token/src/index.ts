import { createServer } from "node:http";
import { createNodeHandler } from "./http-adapter.js";
import { createApp } from "./app.js";
import { createTokenProvider } from "./token-provider.js";
import { readConfig } from "./config.js";
import { authorizeRequest } from "./auth.js";
const config = readConfig();
const provider = createTokenProvider();
const app = createApp({
  generate: provider.generate,
  authorize: authorizeRequest,
  deadlineMs: config.deadlineMs,
});
const server = createServer(createNodeHandler(app));
server.requestTimeout = 25_000;
server.headersTimeout = 10_000;
server.listen(config.port, "0.0.0.0", () =>
  console.log(JSON.stringify({ event: "listening", port: config.port })),
);
process.on("SIGTERM", () => {
  server.close();
  setTimeout(() => process.exit(0), 22_000).unref();
});
