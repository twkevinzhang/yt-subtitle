import { it, expect } from "vitest";
import { commentMessages, parseCommentReply } from "../../src/youtube/comments";

const video = {
  schemaVersion: 1 as const,
  videoId: "SX_ViT4Ra7k",
  title: "米津玄師 - Lemon",
  channel: "Kenshi Yonezu",
  description: "",
  durationMs: 274000,
};
const batch = {
  videoId: video.videoId,
  comments: [
    {
      id: "c1",
      author: "a",
      text: "1 billion views!",
      pinned: false,
      url: "https://www.youtube.com/watch?v=SX_ViT4Ra7k&lc=c1",
    },
  ],
} as never;

it("says what to answer when the comments hold no lyrics, in both messages", () => {
  const [system, user] = commentMessages(video, batch);
  for (const message of [system!, user!]) {
    expect(message.content).toContain("留言區沒有歌詞");
    expect(message.content).toContain("JSON");
  }
  expect(user!.content).toContain("1 billion views!");
  expect(user!.content).toContain("不要提問");
});
it("keeps a prose reply visible instead of calling it a format error", () => {
  const result = parseCommentReply(
    "This is metadata for the video. What would you like me to do with it?",
    batch,
  );
  expect(result.candidates).toEqual([]);
  expect(result.error).toContain("What would you like me to do with it?");
});
it("passes the model's own 'no lyrics' answer through", () => {
  const result = parseCommentReply(
    '{"candidates":[],"error":"留言區沒有歌詞"}',
    batch,
  );
  expect(result.error).toBe("留言區沒有歌詞");
});
