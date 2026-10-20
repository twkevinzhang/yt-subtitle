import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { Panel } from "../../src/ui/Panel";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../src/shared/messages", () => ({ request }));
vi.mock("../../src/ui/user-action", () => ({ isUserAction: () => true }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const prefs = {
  mode: "original" as const,
  targetLanguage: "zh-Hant" as const,
  fontSize: 28,
  position: "bottom" as const,
};
const video = {
  schemaVersion: 1 as const,
  videoId: "12345678901",
  title: "song",
  channel: "artist",
  description: "",
  durationMs: 10000,
};
const overlay = {
  beginDraft: vi.fn(),
  setDraftPreview: vi.fn(),
  setResult: vi.fn(),
  stop: vi.fn(),
  destroy: vi.fn(),
};
function setup(
  tracks: any[] = [],
  configured = false,
  savedResults: any[] = [],
) {
  request.mockImplementation(async (m: any) =>
    m.type === "settings-public"
      ? {
          configured,
          settingsRevision: 1,
          sources: [],
          model: "m",
          baseUrl: "",
          preferences: prefs,
        }
      : m.type === "inspect"
        ? { video, tracks, selectedTrackId: "j" }
        : m.type === "results-list"
          ? savedResults
          : m.type === "read-manual-track"
            ? [{ id: "c", text: "manual lyrics", startMs: 1000, endMs: 3000 }]
            : null,
  );
  render(
    <Panel
      binding={{
        video: document.createElement("video"),
        container: document.createElement("div"),
        videoId: video.videoId,
        isAd: () => false,
      }}
      overlay={overlay}
      onClose={() => {}}
    />,
  );
}
it("shows exactly the three source choices and no file import", async () => {
  setup([{ id: "auto", isAuto: true, isTranslated: false, language: "ja" }]);
  await screen.findByRole("button", { name: "貼入字幕" });
  expect(
    screen.getByRole("button", { name: "YT 字幕" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(document.querySelector('input[type="file"]')).toBeNull();
  expect(screen.queryByText(/匯入 LRC/)).toBeNull();
});
it("uses selected manual captions directly and preserves their times", async () => {
  setup([
    {
      id: "z",
      isAuto: false,
      isTranslated: false,
      language: "zh-Hant",
      label: "中文",
    },
    {
      id: "j",
      isAuto: false,
      isTranslated: false,
      language: "ja",
      label: "日本語",
    },
  ]);
  const button = await screen.findByRole("button", { name: "YT 字幕" });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  fireEvent.click(button);
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith({
      type: "read-manual-track",
      trackId: "j",
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "套用並保存" }));
  await waitFor(() =>
    expect(
      request.mock.calls.some(
        ([m]: any) =>
          m.type === "results-save" &&
          m.result.lines[0].startMs === 1000 &&
          m.result.lines[0].endMs === 3000,
      ),
    ).toBe(true),
  );
  expect(
    request.mock.calls.some(
      ([m]: any) => m.type === "generate" || m.type === "local-model",
    ),
  ).toBe(false);
});
it("accepts pasted timed text without AI configuration or inference", async () => {
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "貼入字幕" }));
  fireEvent.change(screen.getByLabelText("字幕全文"), {
    target: { value: "1\n00:00:01,000 --> 00:00:03,000\nhello" },
  });
  fireEvent.click(screen.getByRole("button", { name: "使用貼入字幕" }));
  fireEvent.click(await screen.findByRole("button", { name: "套用並保存" }));
  await waitFor(() =>
    expect(
      request.mock.calls.some(
        ([m]: any) =>
          m.type === "results-save" && m.result.lines[0].original === "hello",
      ),
    ).toBe(true),
  );
});

it("loads an original-only saved version safely after choosing bilingual display", async () => {
  const saved = {
    schemaVersion: 1,
    key: {
      schemaVersion: 1,
      videoId: video.videoId,
      inputHash: "old",
      targetLanguage: "en",
    },
    videoDurationMs: 10000,
    source: { kind: "user" },
    model: "old",
    offsetMs: 0,
    createdAt: 1,
    updatedAt: 1,
    lines: [
      {
        id: "old",
        original: "saved original",
        startMs: 1000,
        endMs: 2000,
        status: "anchor",
        excluded: false,
        cueIds: [],
      },
    ],
  };
  setup([], false, [saved]);
  const paste = await screen.findByRole("button", { name: "貼入字幕" });
  await waitFor(() => expect(paste.hasAttribute("disabled")).toBe(false));
  fireEvent.click(paste);
  fireEvent.change(screen.getByLabelText("字幕全文"), {
    target: { value: "1\n00:00:01,000 --> 00:00:02,000\ncurrent" },
  });
  fireEvent.click(screen.getByRole("button", { name: "使用貼入字幕" }));
  fireEvent.change(await screen.findByLabelText("顯示方式"), {
    target: { value: "bilingual" },
  });
  fireEvent.click(screen.getByRole("button", { name: "← 返回歌詞" }));
  fireEvent.click(screen.getByRole("button", { name: "本機版本（1）" }));
  fireEvent.click(screen.getByRole("button", { name: "載入這份版本" }));
  expect(overlay.setResult.mock.calls.at(-1)?.[1]).toBe("original");
  expect((screen.getByLabelText("顯示方式") as HTMLSelectElement).value).toBe(
    "original",
  );
});
