import { it, expect, vi } from "vitest";
import { createAiClient } from "../../src/background/ai-client";
const p = {
  schemaVersion: 1 as const,
  baseUrl: "https://ai.test/v1",
  apiToken: "private-token",
  model: "m",
};
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
