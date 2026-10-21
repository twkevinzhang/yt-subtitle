import type { RequestListener } from "node:http";
import { Readable } from "node:stream";

export function createNodeHandler(
  app: (request: Request) => Promise<Response>,
): RequestListener {
  return async (req, res) => {
    try {
      if (!["GET", "POST"].includes(req.method ?? "")) {
        res.writeHead(405);
        res.end();
        return;
      }
      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableFinished) controller.abort();
      });
      const body = req.method === "POST" ? Readable.toWeb(req) : undefined;
      const request = new Request(`http://container${req.url}`, {
        method: req.method,
        headers: req.headers as HeadersInit,
        signal: controller.signal,
        ...(body
          ? { body: body as ReadableStream<Uint8Array>, duplex: "half" }
          : {}),
      });
      const response = await app(request);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!res.destroyed) {
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(bytes);
      }
    } catch {
      if (!res.destroyed) {
        res.writeHead(500);
        res.end();
      }
    }
  };
}
