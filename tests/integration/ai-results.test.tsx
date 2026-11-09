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
it("lists candidates with their source and keeps a failed source's message", () => {
  render(
    <AiResults
      {...props()}
      search={search(
        route("complete", { error: "留言區沒有歌詞" }),
        route("complete", { candidates: [candidate] }),
      )}
    />,
  );
  const select = screen.getByRole("combobox", { name: "選擇字幕" });
  expect(select.textContent).toContain("lyrics.example · Lemon");
  expect(screen.getByText("留言區沒有歌詞")).toBeTruthy();
  expect(select.textContent).toContain("12 行");
});
it("picks a candidate from the dropdown", () => {
  const onSelect = vi.fn();
  render(
    <AiResults
      {...props()}
      onSelect={onSelect}
      search={search(
        route("complete"),
        route("complete", { candidates: [candidate] }),
      )}
    />,
  );
  fireEvent.change(screen.getByRole("combobox", { name: "選擇字幕" }), {
    target: { value: "web:1" },
  });
  expect(onSelect).toHaveBeenCalledWith({ candidate, route: "web" });
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

it("selects the first offer at once and keeps failed sources in one folded note", () => {
  const onSelect = vi.fn();
  render(
    <AiResults
      {...props()}
      onSelect={onSelect}
      search={search(
        route("complete", { error: "留言區沒有歌詞" }),
        route("complete", { candidates: [candidate] }),
      )}
    />,
  );
  expect(onSelect).toHaveBeenCalledWith({ candidate, route: "web" });
  const note = document.querySelector(".subtitle-failures")!;
  expect(note.querySelector("summary")!.textContent).toBe(
    "YouTube 沒有可用歌詞",
  );
  expect((note as HTMLDetailsElement).open).toBe(false);
});
it("names the action 使用這份 and enables it once something is selected", () => {
  render(
    <AiResults
      {...props()}
      selected={{ candidate, route: "web" }}
      search={search(
        route("complete"),
        route("complete", { candidates: [candidate] }),
      )}
    />,
  );
  expect(
    (screen.getByRole("button", { name: "使用這份" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});
