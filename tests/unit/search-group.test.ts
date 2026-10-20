import { it, expect, vi } from "vitest";
import { startSearchGroup } from "../../src/background/search-group";
const video = {
  schemaVersion: 1 as const,
  videoId: "12345678901",
  title: "song",
  channel: "artist",
  description: "",
  durationMs: 10000,
};
it("starts three independent requests and keeps results after a sibling failure", async () => {
  const calls: string[] = [];
  const result = await startSearchGroup(
    video,
    {
      sources: [
        {
          id: "lrclib",
          schemaVersion: 1,
          name: "LRCLIB",
          domain: "lrclib.net",
          includeSubdomains: false,
          enabled: true,
        },
      ],
    } as any,
    new AbortController().signal,
    () => {},
    async (route) => {
      calls.push(route);
      if (route === "comments") throw new Error("comments unavailable");
      return {
        text: '{"candidates":[]}',
        evidence: { status: "unverified", citations: [] },
      };
    },
  );
  expect(calls).toEqual(["configured", "comments", "web"]);
  expect(result.routes.comments.phase).toBe("failed");
  expect(result.routes.web.phase).toBe("complete");
});
it("skips only the unconfigured route and permits web results outside configured domains", async () => {
  const send = vi.fn(async () => ({
    text: JSON.stringify({
      candidates: [
        {
          id: "a",
          title: "song",
          artist: "artist",
          version: "live",
          language: "en",
          sourceId: "web",
          url: "https://example.com/lyrics",
          fullText: "hello",
          syncedLyrics: null,
          matchReason: "title",
        },
      ],
    }),
    evidence: { status: "unverified" as const, citations: [] },
  }));
  const result = await startSearchGroup(
    video,
    { sources: [] } as any,
    new AbortController().signal,
    () => {},
    send,
  );
  expect(send).toHaveBeenCalledTimes(2);
  expect(result.routes.configured.phase).toBe("unconfigured");
  expect(result.routes.web.candidates).toHaveLength(1);
});
