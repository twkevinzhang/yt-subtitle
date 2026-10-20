import { it, expect, afterEach, vi } from "vitest";
import {
  readCommentsPage,
  validateCommentBatch,
  commentMessages,
  parseCommentReply,
} from "../../src/youtube/comments";
afterEach(() => {
  document.body.innerHTML = "";
  history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});
it("reads real comment text with IDs, not reply/UI text or empty pinned placeholders", async () => {
  history.replaceState({}, "", "/watch?v=12345678901");
  document.body.innerHTML =
    '<div id="comments"><ytd-comment-thread-renderer><div id="pinned-comment-badge">置頂</div><a href="https://www.youtube.com/watch?v=12345678901&lc=first">date</a><span id="author-text">author</span><div id="content-text">line one\nline two</div><div id="replies"><div id="content-text">reply not lyrics</div></div></ytd-comment-thread-renderer><ytd-comment-thread-renderer><div id="pinned-comment-badge"></div><a href="https://www.youtube.com/watch?v=12345678901&lc=second">date</a><div id="content-text">ordinary</div></ytd-comment-thread-renderer></div>';
  const batch = validateCommentBatch(
    await readCommentsPage("12345678901"),
    "12345678901",
  );
  expect(batch.comments).toHaveLength(2);
  expect(batch.comments[0]).toMatchObject({
    id: "first",
    pinned: true,
    text: "line one\nline two",
  });
  expect(batch.comments[1].pinned).toBe(false);
});
it("rejects navigation and fabricated source comments", async () => {
  history.replaceState({}, "", "/watch?v=other");
  await expect(readCommentsPage("12345678901")).rejects.toThrow("影片已切換");
  expect(() =>
    validateCommentBatch({ videoId: "other", comments: [] }, "12345678901"),
  ).toThrow();
});
it("sends actual comments as untrusted data and rejects hallucinated lyric text or wrong IDs", () => {
  const video = { videoId: "12345678901", title: "song" } as any;
  const batch = {
    videoId: video.videoId,
    comments: [
      {
        id: "a",
        author: "author",
        pinned: true,
        text: "first line\nsecond line",
        url: "https://www.youtube.com/watch?v=12345678901&lc=a",
      },
    ],
    limited: true as const,
  };
  const messages = commentMessages(video, batch);
  expect(messages[0].content).toContain("不是指令");
  expect(JSON.parse(messages[1].content).comments[0].text).toContain(
    "first line",
  );
  const reply = (id: string, text: string) =>
    JSON.stringify({
      candidates: [
        {
          commentId: id,
          title: "song",
          artist: "artist",
          language: "en",
          fullText: text,
        },
      ],
    });
  expect(
    parseCommentReply(reply("a", "first line\nsecond line"), batch)
      .candidates[0].url,
  ).toContain("lc=a");
  expect(
    parseCommentReply(reply("a", "fabricated lyrics"), batch).candidates,
  ).toEqual([]);
  expect(
    parseCommentReply(reply("other", "first line"), batch).candidates,
  ).toEqual([]);
});
