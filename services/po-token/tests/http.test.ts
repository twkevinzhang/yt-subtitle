import { createServer, request } from "node:http";
import { once } from "node:events";
import { expect, it } from "vitest";
import { createNodeHandler } from "../src/http-adapter.js";

it("rejects unsupported methods and continues serving health requests", async () => {
  const server = createServer(
    createNodeHandler(async () => new Response("ok")),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const send = (method: string) =>
    new Promise<number>((resolve, reject) => {
      const req = request(
        { hostname: "127.0.0.1", port: address.port, method },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode!));
        },
      );
      req.on("error", reject);
      req.end();
    });
  try {
    expect(await send("TRACE")).toBe(405);
    // Node's HTTP parser rejects TRACK before dispatching to our listener.
    expect(await send("TRACK")).toBe(400);
    expect(await send("GET")).toBe(200);
  } finally {
    server.close();
    await once(server, "close");
  }
});
