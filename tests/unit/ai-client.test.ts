import { it, expect, vi } from "vitest";
import { createAiClient } from "../../src/background/ai-client";
const p = {
  schemaVersion: 1 as const,
  baseUrl: "https://ai.test/v1",
  apiToken: "private-token",
  model: "m",
};
it("sends edited alignment body verbatim in one request, keeping credentials in headers", async () => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({ choices: [{ message: { content: '{"lines":[]}' } }] }),
  );
  const body = {
    model: "edited",
    messages: [{ role: "user", content: "whole song" }],
    stream: false,
    temperature: 0.1,
  };
  await createAiClient(p, fetcher).completeText(
    [],
    new AbortController().signal,
    body,
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual(body);
  expect(fetcher.mock.calls[0][1]!.headers).toMatchObject({
    Authorization: "Bearer private-token",
  });
  expect(JSON.stringify(body)).not.toContain("private-token");
});
it("returns full diagnostic JSON and HTTP errors without altering the edited request body", async () => {
  const body = {
    model: "edited-model",
    input: "find lyrics",
    stream: false,
    store: false,
  };
  const payload = {
    error: { message: "Invalid model", code: "model_not_found" },
  };
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    Response.json(payload, { status: 400 }),
  );
  expect(
    await createAiClient(p, fetcher).testSearch(
      body,
      new AbortController().signal,
    ),
  ).toEqual({ status: 400, body: payload });
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual(body);
});
it("retains non-JSON diagnostic responses and identifies missing HTTP responses", async () => {
  const client = createAiClient(
    p,
    vi.fn(
      async () => new Response("<html>Access denied</html>", { status: 403 }),
    ),
  );
  expect(await client.testSearch({}, new AbortController().signal)).toEqual({
    status: 403,
    body: "<html>Access denied</html>",
  });
  const offline = createAiClient(
    p,
    vi.fn(async () => {
      throw new TypeError("network");
    }),
  );
  expect(
    await offline.testSearch({}, new AbortController().signal),
  ).toMatchObject({ status: null, error: expect.stringContaining("連線失敗") });
});
it("enables Responses web search and reads actual tool evidence", async () => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({
      output: [
        {
          type: "web_search_call",
          id: "ws_1",
          status: "completed",
          action: { sources: [{ url: "https://lrclib.net/docs" }] },
        },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "搜尋結果",
              annotations: [
                { type: "url_citation", url: "https://lrclib.net/docs" },
              ],
            },
          ],
        },
      ],
    }),
  );
  const result = await createAiClient(p, fetcher).searchText(
    [],
    new AbortController().signal,
  );
  expect(fetcher.mock.calls[0][0]).toBe("https://ai.test/v1/responses");
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({
    tools: [{ type: "web_search" }],
    tool_choice: { type: "web_search" },
  });
  expect(result).toMatchObject({
    text: "搜尋結果",
    evidence: { status: "verified", citations: ["https://lrclib.net/docs"] },
  });
});
it("does not verify search from model text or citations without a completed tool", async () => {
  for (const status of [undefined, "failed"]) {
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          output: [
            ...(status ? [{ type: "web_search_call", status }] : []),
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: '{"verified":true}',
                  annotations: [
                    { type: "url_citation", url: "https://lrclib.net/docs" },
                  ],
                },
              ],
            },
          ],
        }),
    );
    expect(
      (
        await createAiClient(p, fetcher).searchText(
          [],
          new AbortController().signal,
        )
      ).evidence.status,
    ).toBe("unverified");
  }
});
it("preserves the exact assistant text for search tests even when it is not JSON", async () => {
  const text = "目前無法搜尋網路。\n請提供歌詞來源。";
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: text } }] }),
        { headers: { "Content-Type": "application/json" } },
      ),
  );
  const client = createAiClient(p, fetcher);
  expect(await client.completeText([], new AbortController().signal)).toBe(
    text,
  );
  expect(fetcher.mock.calls[0][0]).toBe("https://ai.test/v1/chat/completions");
  expect(
    JSON.parse(fetcher.mock.calls[0][1]!.body as string).tools,
  ).toBeUndefined();
  await expect(
    client.completeJson([], new AbortController().signal),
  ).rejects.toThrow("不是有效 JSON");
});
it("lists models before selection but never sends a completion with an empty model", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ data: [{ id: "available-model" }] }), {
      headers: { "Content-Type": "application/json" },
    }),
  );
  const client = createAiClient({ ...p, model: "" }, fetcher);
  expect(await client.listModels(new AbortController().signal)).toEqual([
    "available-model",
  ]);
  await expect(
    client.completeJson([], new AbortController().signal),
  ).rejects.toThrow("選擇模型");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects login HTML without exposing response secrets", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response("<html>private-token</html>", {
      headers: { "Content-Type": "text/html" },
    }),
  );
  await expect(
    createAiClient(p, fetcher).listModels(new AbortController().signal),
  ).rejects.toThrow("JSON");
  expect(fetcher.mock.calls[0][1].redirect).toBe("error");
});
it("does not trust model claims of search verification", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"verified":true}' } }],
      }),
      { headers: { "Content-Type": "application/json" } },
    ),
  );
  expect(
    (
      await createAiClient(p, fetcher).completeJson(
        [],
        new AbortController().signal,
      )
    ).evidence.status,
  ).toBe("unverified");
});
it("aborts and rejects HTTP errors", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response("{}", {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  );
  await expect(
    createAiClient(p, fetcher).listModels(new AbortController().signal),
  ).rejects.toThrow("401");
});
