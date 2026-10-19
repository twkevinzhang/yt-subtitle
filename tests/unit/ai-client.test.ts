import { it, expect, vi } from "vitest";
import { createAiClient } from "../../src/background/ai-client";
const p = {
  schemaVersion: 1 as const,
  baseUrl: "https://ai.test/v1",
  apiToken: "private-token",
  model: "m",
};
it("preserves the exact assistant text for search tests even when it is not JSON", async () => {
  const text = "目前無法搜尋網路。\n請提供歌詞來源。";
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: text } }] }),
        { headers: { "Content-Type": "application/json" } },
      ),
  );
  const client = createAiClient(p, fetcher);
  expect(await client.completeText([], new AbortController().signal)).toBe(
    text,
  );
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
