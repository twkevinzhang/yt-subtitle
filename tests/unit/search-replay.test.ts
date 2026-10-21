import { it, expect, vi, afterEach } from "vitest";
import { startSearchGroup } from "../../src/background/search-group";
import { createAiClient } from "../../src/background/ai-client";
afterEach(() => vi.unstubAllGlobals());
const provider = {
  schemaVersion: 1 as const,
  baseUrl: "https://ai.test/v1",
  model: "m",
  apiToken: "secret",
};
const video = {
  schemaVersion: 1 as const,
  videoId: "12345678901",
  title: "song",
  channel: "artist",
  description: "",
  durationMs: 10000,
};
it("replays just the selected route with the exact edited body and keeps sibling results", async () => {
  const sent: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body), headers: init.headers });
      return new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: '{"candidates":[]}' }],
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }),
  );
  const previous: any = {
    id: "g",
    videoId: video.videoId,
    routes: {
      configured: {
        phase: "complete",
        text: "keep configured",
        candidates: [],
      },
      comments: { phase: "failed", text: "keep comments", candidates: [] },
      web: { phase: "complete", text: "old web", candidates: [] },
    },
  };
  const body = {
    model: "edited-model",
    input: "new prompt",
    tools: [],
    custom: { preserve: true },
    stream: false,
  };
  const result = await startSearchGroup(
    video,
    { provider, sources: [] } as any,
    new AbortController().signal,
    () => {},
    undefined,
    undefined,
    { onlyRoute: "web", body, previous },
  );
  expect(sent).toHaveLength(1);
  expect(sent[0].body).toEqual(body);
  expect(sent[0].url).toBe("https://ai.test/v1/responses");
  expect(JSON.stringify(sent[0].body)).not.toContain("secret");
  expect(result.routes.configured.text).toBe("keep configured");
  expect(result.routes.comments.text).toBe("keep comments");
  expect(result.routes.web.phase).toBe("complete");
  expect(result.routes.web.rawResponse).toEqual({
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: '{"candidates":[]}' }],
      },
    ],
  });
});
it("preserves non-JSON HTTP failures for inspection", async () => {
  const client = createAiClient(
    provider,
    async () => new Response("upstream unavailable", { status: 503 }),
  );
  const result = await client.inspectRequest(
    "responses",
    { model: "m" },
    new AbortController().signal,
  );
  expect(result.rawResponse).toBe("upstream unavailable");
  expect(result.httpStatus).toBe(503);
  expect(result.error).toContain("503");
});
it("extracts the original chat reply without changing the edited parameters", async () => {
  let sent: unknown;
  const client = createAiClient(provider, async (_url, init) => {
    sent = JSON.parse(init!.body as string);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "raw reply" } }] }),
    );
  });
  const body = {
    model: "different",
    messages: [{ role: "user", content: "text" }],
    temperature: 0.2,
    extra: { a: 1 },
  };
  const result = await client.inspectRequest(
    "chat/completions",
    body,
    new AbortController().signal,
  );
  expect(sent).toEqual(body);
  expect(result.text).toBe("raw reply");
});
it("cancels one initial source without aborting sibling searches", async () => {
  const controllers = new Map<string, AbortController>();
  const result = await startSearchGroup(
    video,
    { provider, sources: [{ enabled: true }] } as any,
    new AbortController().signal,
    () => {},
    async (route, _messages, signal) => {
      if (route === "configured")
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          );
          queueMicrotask(() => controllers.get(route)!.abort());
        });
      return { text: '{"candidates":[]}' };
    },
    async () => ({ videoId: video.videoId, limited: true, comments: [] }),
    undefined,
    (route, controller) => {
      controllers.set(route, controller);
      return () => {};
    },
  );
  expect(result.routes.configured.phase).toBe("cancelled");
  expect(result.routes.web.phase).toBe("complete");
  expect(controllers.get("web")!.signal.aborted).toBe(false);
});
