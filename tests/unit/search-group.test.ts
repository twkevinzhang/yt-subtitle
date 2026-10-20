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
const readComments = async () => ({
  videoId: video.videoId,
  limited: true as const,
  comments: [
    {
      id: "a",
      author: "author",
      text: "actual lyrics",
      pinned: true,
      url: "https://www.youtube.com/watch?v=12345678901&lc=a",
    },
  ],
});
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
    readComments,
  );
  expect([...calls].sort()).toEqual(["comments", "configured", "web"]);
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
    readComments,
  );
  expect(send).toHaveBeenCalledTimes(2);
  expect(result.routes.configured.phase).toBe("unconfigured");
  expect(result.routes.web.candidates).toHaveLength(1);
});
it("reads comments before inference and does not ask AI to guess when reading fails", async () => {
  const read = vi.fn(async () => {
      throw Error("留言未載入");
    }),
    send = vi.fn(async () => ({ text: '{"candidates":[]}' }));
  const result = await startSearchGroup(
    video,
    { sources: [] } as any,
    new AbortController().signal,
    () => {},
    send,
    read,
  );
  expect(read).toHaveBeenCalledTimes(1);
  expect(send.mock.calls.map((c) => (c as any)[0])).toEqual(["web"]);
  expect(result.routes.comments.error).toBe("留言未載入");
});
it("keeps a grounded result tied to the actual comment source", async () => {
  const result = await startSearchGroup(
    video,
    { sources: [] } as any,
    new AbortController().signal,
    () => {},
    async (route, messages) => ({
      text:
        route === "comments"
          ? JSON.stringify({
              candidates: [
                {
                  commentId: "a",
                  title: "song",
                  artist: "artist",
                  language: "en",
                  fullText: "actual lyrics",
                },
              ],
            })
          : '{"candidates":[]}',
    }),
    readComments,
  );
  expect(result.routes.comments.commentsRead).toEqual({ count: 1, pinned: 1 });
  expect(result.routes.comments.candidates[0].evidence.toolEvidence).toContain(
    "source-text-matched",
  );
});
it("does not start read or inference on an already cancelled group", async () => {
  const controller = new AbortController();
  controller.abort();
  const read = vi.fn(readComments),
    send = vi.fn(async () => ({ text: '{"candidates":[]}' }));
  const result = await startSearchGroup(
    video,
    { sources: [] } as any,
    controller.signal,
    () => {},
    send,
    read,
  );
  expect(read).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(result.routes.comments.phase).toBe("cancelled");
});
