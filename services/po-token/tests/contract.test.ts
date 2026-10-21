import { expect, it } from "vitest";
import { createApp } from "../src/app.js";
it("never passes extra provider properties through the public contract", async () => {
  const app = createApp({
    authorize: () => true,
    generate: async () => ({
      poToken: "dGVzdA",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      upstreamSecret: "do-not-return",
    }),
  });
  const r = await app(
    new Request("https://api.test/v1/po-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoId: "e1ZMmRlsaaU" }),
    }),
  );
  expect(Object.keys(await r.json()).sort()).toEqual([
    "expiresAt",
    "poToken",
    "videoId",
  ]);
});
