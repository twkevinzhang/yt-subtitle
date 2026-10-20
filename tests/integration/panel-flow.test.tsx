import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import { Panel } from "../../src/ui/Panel";
const mock = vi.hoisted(() => ({
  request: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(async () => {}),
  publish: undefined as any,
}));
vi.mock("../../src/shared/messages", () => ({ request: mock.request }));
vi.mock("../../src/ui/user-action", () => ({ isUserAction: () => true }));
vi.mock("../../src/ui/use-subtitle-work", () => ({
  useSubtitleWork: (_b: any, p: any) => {
    mock.publish = p;
    return { start: mock.start, cancel: mock.cancel, busy: false };
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function setup(alignmentMode = "background") {
  const overlay = {
    beginDraft: vi.fn(),
    setDraftPreview: vi.fn(),
    setResult: vi.fn(),
    stop: vi.fn(),
    destroy: vi.fn(),
  };
  const settings = {
    configured: true,
    settingsRevision: 1,
    model: "m",
    baseUrl: "https://test/v1",
    sources: [],
    preferences: {
      mode: "original",
      targetLanguage: "ja",
      position: "bottom",
      fontSize: 28,
      alignmentMode,
    },
  };
  const candidate = (id: string) => ({
    schemaVersion: 1,
    id,
    title: id,
    artist: "artist",
    language: "en",
    version: "live",
    sourceId: id,
    url: `https://example.com/${id}`,
    fullText: null,
    syncedLyrics: `1\n00:00:01,000 --> 00:00:03,000\n${id}`,
    matchReason: "match",
    evidence: { status: "unverified", citations: [] },
  });
  const snapshot = {
    id: "g",
    videoId: "12345678901",
    routes: {
      configured: {
        phase: "complete",
        text: "raw",
        candidates: [candidate("configured")],
      },
      comments: {
        phase: "failed",
        text: "",
        error: "留言區不可用",
        candidates: [],
      },
      web: { phase: "complete", text: "raw", candidates: [candidate("web")] },
    },
  };
  mock.request.mockImplementation(async (m: any) =>
    m.type === "settings-public"
      ? settings
      : m.type === "inspect"
        ? {
            video: {
              schemaVersion: 1,
              videoId: "12345678901",
              durationMs: 10000,
              title: "song",
              channel: "",
              description: "",
            },
            tracks: [],
          }
        : m.type === "results-list"
          ? []
          : m.type === "search-start"
            ? { id: "g" }
            : m.type === "search-group"
              ? snapshot
              : null,
  );
  mock.start.mockImplementation(async () => {});
  render(
    <Panel
      binding={{
        video: document.createElement("video"),
        container: document.body,
        videoId: "12345678901",
        isAd: () => false,
      }}
      overlay={overlay}
      onClose={() => {}}
    />,
  );
  return { overlay, snapshot };
}
async function paste(value: string) {
  const button = await screen.findByRole("button", { name: "貼入字幕" });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  fireEvent.click(button);
  fireEvent.change(screen.getByLabelText("字幕全文"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "使用貼入字幕" }));
  await screen.findByRole("heading", { name: "逐句預覽與校時" });
}
it("presents route results independently and only adopts the selected candidate", async () => {
  const { overlay } = setup();
  const ai = await screen.findByRole("button", { name: "AI 找字幕" });
  await waitFor(() => expect(ai.hasAttribute("disabled")).toBe(false));
  fireEvent.click(ai);
  const web = await screen.findByRole("region", { name: "全網搜尋" });
  await within(web).findByText("web — artist");
  expect(screen.getByText("留言區不可用")).toBeTruthy();
  expect(overlay.setDraftPreview).not.toHaveBeenCalled();
  fireEvent.click(within(web).getByRole("button", { name: "使用這個版本" }));
  await waitFor(() =>
    expect((screen.getByLabelText("原文") as HTMLTextAreaElement).value).toBe(
      "web",
    ),
  );
  expect(mock.request).toHaveBeenCalledWith({ type: "search-cancel", id: "g" });
  expect(mock.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "套用並保存" }));
  await waitFor(() =>
    expect(
      mock.request.mock.calls.some(
        ([m]) =>
          m.type === "results-save" && m.result.subtitleSource.kind === "web",
      ),
    ).toBe(true),
  );
});
it("keeps untimed rows visible and blocks save/export until excluded or manually timed", async () => {
  setup();
  await paste("unknown lyrics");
  await waitFor(() => expect(mock.start).toHaveBeenCalled());
  expect(
    screen.getByRole("button", { name: "下載 SRT" }).hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("第 1 句開始秒數"), {
    target: { value: "1" },
  });
  fireEvent.change(screen.getByLabelText("第 1 句結束秒數"), {
    target: { value: "2" },
  });
  expect(
    screen.getByRole("button", { name: "套用並保存" }).hasAttribute("disabled"),
  ).toBe(false);
});
it("keeps a previous draft after malformed paste and leaves its text unchanged", async () => {
  setup();
  await paste("1\n00:00:01,000 --> 00:00:03,000\nprevious");
  fireEvent.click(screen.getByRole("button", { name: "貼入字幕" }));
  fireEvent.change(screen.getByLabelText("字幕全文"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "使用貼入字幕" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "← 返回歌詞" }));
  fireEvent.click(screen.getByRole("button", { name: "製作／編輯" }));
  expect((screen.getByLabelText("原文") as HTMLTextAreaElement).value).toBe(
    "previous",
  );
});
it.each(["background", "buffer-before-play", "complete-before-use"])(
  "applies %s publication policy and preserves unfinished rows",
  async (mode) => {
    const { overlay } = setup(mode);
    await paste("first\nunknown");
    await waitFor(() => expect(mock.start).toHaveBeenCalled());
    const lines = mock.start.mock.calls[0][0];
    const p = {
      key: { runId: "r", tabId: 0, videoId: "12345678901", draftRevision: 1 },
      mode,
      generation: 0,
      sequence: 1,
      checked: [],
      ready: [],
      phase: "partial",
      lines: [
        { ...lines[0], status: "estimated", startMs: 1000, endMs: 2000 },
        lines[1],
      ],
    };
    await act(async () => mock.publish(p));
    expect(overlay.setDraftPreview.mock.calls.length).toBe(
      mode === "complete-before-use" ? 0 : 1,
    );
    expect(
      screen.getByRole("button", { name: "下載 SRT" }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "只看待處理" }));
    expect(screen.getAllByLabelText("原文")).toHaveLength(1);
    fireEvent.click(screen.getByRole("checkbox", { name: "排除這句" }));
    expect(
      screen
        .getByRole("button", { name: "套用並保存" })
        .hasAttribute("disabled"),
    ).toBe(false);
  },
);
it("cancels a search whose start acknowledgement arrives after the user cancels", async () => {
  setup();
  const fallback = mock.request.getMockImplementation()!;
  let release!: (value: any) => void;
  mock.request.mockImplementation((m: any) =>
    m.type === "search-start"
      ? new Promise((resolve) => {
          release = resolve;
        })
      : fallback(m),
  );
  const ai = await screen.findByRole("button", { name: "AI 找字幕" });
  await waitFor(() => expect(ai.hasAttribute("disabled")).toBe(false));
  fireEvent.click(ai);
  await waitFor(() => expect(release).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "取消搜尋" }));
  await act(async () => release({ id: "late" }));
  await waitFor(() =>
    expect(mock.request).toHaveBeenCalledWith({
      type: "search-cancel",
      id: "late",
    }),
  );
  expect(
    mock.request.mock.calls.some(
      ([m]) => m.type === "search-group" && m.id === "late",
    ),
  ).toBe(false);
});
