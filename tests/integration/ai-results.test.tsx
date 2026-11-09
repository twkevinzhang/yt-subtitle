import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);
import { AiResults } from "../../src/ui/AiResults";

const lines = (n: number) =>
  Array.from({ length: n }, (_, i) => `歌詞第${i + 1}行`).join("\n");
const candidate = {
  schemaVersion: 1 as const,
  id: "1",
  title: "Lemon",
  artist: "米津玄師",
  version: "原曲",
  language: "ja",
  sourceId: "web",
  url: "https://lyrics.example/lemon",
  fullText: lines(12),
  syncedLyrics: null,
  matchReason: "相符",
  evidence: { status: "unverified" as const, citations: [] },
};
const route = (phase: string, extra: object = {}) => ({
  phase,
  text: "",
  candidates: [],
  ...extra,
});
const search = (comments: object, web: object) =>
  ({ id: "s", videoId: "SX_ViT4Ra7k", routes: { comments, web } }) as never;
const props = () => ({
  searching: false,
  pending: false,
  onSelect: vi.fn(),
  onUseSelected: vi.fn(),
  onSearchAgain: vi.fn(),
  onPaste: vi.fn(),
});

it("shows no tags when the AI returned no source, only what it said", () => {
  render(
    <AiResults
      {...props()}
      search={search(
        route("complete", { error: "留言區沒有歌詞" }),
        route("complete", { error: "AI 沒有照指定格式回覆：This is metadata" }),
      )}
    />,
  );
  expect(screen.getByRole("heading", { name: "AI搜尋結果" })).toBeTruthy();
  expect(document.querySelector(".subtitle-badge")).toBeNull();
  expect(screen.getByText("留言區沒有歌詞")).toBeTruthy();
  expect(screen.getByText(/This is metadata/)).toBeTruthy();
  expect(screen.queryByRole("group", { name: "選擇字幕" })).toBeNull();
});
it("offers pasting as the main action when nothing was found", () => {
  const p = props();
  render(
    <AiResults
      {...p}
      search={search(
        route("complete", { error: "x" }),
        route("complete", { error: "y" }),
      )}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "貼入歌詞" }));
  fireEvent.click(screen.getByRole("button", { name: "重新搜尋" }));
  expect(p.onPaste).toHaveBeenCalledOnce();
  expect(p.onSearchAgain).toHaveBeenCalledOnce();
});
it("tags a source that found lyrics and keeps one that found none quiet", () => {
  render(
    <AiResults
      {...props()}
      search={search(
        route("complete", { error: "留言區沒有歌詞" }),
        route("complete", { candidates: [candidate] }),
      )}
    />,
  );
  const tags = Array.from(document.querySelectorAll(".subtitle-badge"));
  expect(tags.map((t) => t.className)).toEqual([
    "subtitle-badge quiet",
    "subtitle-badge done",
  ]);
  expect(tags[0]!.textContent).toContain("YouTube");
  expect(tags[1]!.textContent).toContain("找到 1 份");
  expect(screen.getByText(/12 行/)).toBeTruthy();
  expect(screen.getByText(/歌詞第1行 \/ 歌詞第2行 \/ 歌詞第3行/)).toBeTruthy();
});
it("does not offer a candidate that has no lyric text", () => {
  render(
    <AiResults
      {...props()}
      search={search(
        route("complete", { error: "留言區沒有歌詞" }),
        route("complete", {
          candidates: [{ ...candidate, fullText: null }],
          error: "AI 沒有取得含歌詞全文的頁面",
        }),
      )}
    />,
  );
  expect(screen.queryByRole("group", { name: "選擇字幕" })).toBeNull();
  expect(document.querySelector(".subtitle-badge")).toBeNull();
});
it("hides the actions while a search is still running", () => {
  render(
    <AiResults
      {...props()}
      searching
      search={search(route("pending"), route("pending"))}
    />,
  );
  expect(screen.queryByRole("button", { name: "重新搜尋" })).toBeNull();
  expect(document.querySelector(".subtitle-badge")).toBeNull();
});
