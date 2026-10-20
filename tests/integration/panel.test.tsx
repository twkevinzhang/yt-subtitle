import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import {
  render,
  fireEvent,
  screen,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { Consent } from "../../src/ui/Consent";
import { Editor } from "../../src/ui/Editor";
import { Panel } from "../../src/ui/Panel";
const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }));
vi.mock("../../src/shared/messages", () => ({ request: mockRequest }));
vi.mock("../../src/ui/user-action", () => ({ isUserAction: () => true }));
afterEach(cleanup);
it("loads video independently of cache and keeps local paste available while captions are pending", async () => {
  mockRequest.mockClear();
  const settings = {
    configured: false,
    baseUrl: "",
    model: "",
    settingsRevision: 0,
    sources: [],
    preferences: {
      mode: "original",
      targetLanguage: "zh-Hant",
      fontSize: 28,
      position: "bottom",
    },
  };
  let finishVideo!: (value: any) => void;
  mockRequest.mockImplementation((m: any) => {
    if (m.type === "settings-public") return Promise.resolve(settings);
    if (m.type === "inspect")
      return new Promise((resolve) => {
        finishVideo = resolve;
      });
    return new Promise(() => {});
  });
  render(
    <Panel
      binding={{
        video: document.createElement("video"),
        container: document.createElement("div"),
        videoId: "12345678901",
        isAd: () => false,
      }}
      overlay={{
        beginDraft: vi.fn(),
        setDraftPreview: vi.fn(),
        setResult: vi.fn(),
        stop: vi.fn(),
        destroy: vi.fn(),
      }}
      onClose={() => {}}
    />,
  );
  await screen.findByRole("status", { name: "正在載入影片資訊" });
  await waitFor(() => expect(finishVideo).toBeTypeOf("function"));
  finishVideo({
    video: {
      schemaVersion: 1,
      videoId: "12345678901",
      title: "延遲字幕測試",
      channel: "test",
      description: "",
      durationMs: 10000,
    },
    tracks: [
      {
        id: "0",
        label: "日文",
        isAuto: true,
        isTranslated: false,
        language: "ja",
      },
    ],
  });
  await screen.findByText("延遲字幕測試");
  expect(screen.getByRole("button", { name: "貼入字幕" })).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "字幕全文" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "貼入字幕" }));
  fireEvent.change(screen.getByLabelText("字幕全文"), {
    target: { value: "1\n00:00:01,000 --> 00:00:02,000\n本機歌詞" },
  });
  fireEvent.click(screen.getByRole("button", { name: "使用貼入字幕" }));
  await screen.findByRole("heading", { name: "逐句預覽與校時" });
  fireEvent.click(screen.getByRole("button", { name: "← 返回歌詞" }));
  const preview = screen.getByLabelText("整段歌詞");
  preview.scrollTop = 120;
  fireEvent.click(screen.getByRole("button", { name: "製作／編輯" }));
  expect(screen.getByRole("textbox", { name: "原文" })).toHaveProperty(
    "value",
    "本機歌詞",
  );
  fireEvent.click(screen.getByRole("button", { name: "← 返回歌詞" }));
  expect(preview.scrollTop).toBe(120);
  expect(
    mockRequest.mock.calls.some(
      ([m]) => m.type === "read-track" || m.type === "read-manual-track",
    ),
  ).toBe(false);
  expect(screen.queryByRole("status", { name: "正在載入影片資訊" })).toBeNull();
});
it("resaving a loaded result retains its real source, translation language and model", async () => {
  mockRequest.mockClear();
  const saved = {
    schemaVersion: 1,
    key: {
      schemaVersion: 1,
      videoId: "12345678901",
      inputHash: "saved",
      targetLanguage: "en",
    },
    source: { kind: "network", url: "https://lrclib.net/old" },
    model: "old-model",
    videoDurationMs: 10000,
    lines: [
      {
        id: "l0",
        original: "old original",
        translation: "old English",
        startMs: 1000,
        endMs: 2000,
        cueIds: [],
        status: "manual",
        excluded: false,
      },
    ],
    offsetMs: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  mockRequest.mockImplementation(async (m: any) =>
    m.type === "settings-public"
      ? {
          configured: true,
          baseUrl: "https://test/v1",
          model: "new-model",
          settingsRevision: 1,
          sources: [],
          preferences: {
            mode: "original",
            targetLanguage: "ja",
            fontSize: 28,
            position: "bottom",
          },
        }
      : m.type === "results-list"
        ? [saved]
        : m.type === "results-save"
          ? undefined
          : {
              video: {
                schemaVersion: 1,
                videoId: "12345678901",
                title: "test",
                channel: "",
                description: "",
                durationMs: 10000,
              },
              tracks: [],
            },
  );
  render(
    <Panel
      binding={{
        video: document.createElement("video"),
        container: document.createElement("div"),
        videoId: "12345678901",
        isAd: () => false,
      }}
      overlay={{
        beginDraft: vi.fn(),
        setDraftPreview: vi.fn(),
        setResult: vi.fn(),
        stop: vi.fn(),
        destroy: vi.fn(),
      }}
      onClose={() => {}}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "本機版本（1）" }));
  fireEvent.click(await screen.findByRole("button", { name: "載入這份版本" }));
  await screen.findByRole("heading", { name: "逐句預覽與校時" });
  fireEvent.click(screen.getByRole("button", { name: "套用並保存" }));
  await waitFor(() =>
    expect(
      mockRequest.mock.calls.some(([m]) => m.type === "results-save"),
    ).toBe(true),
  );
  const payload = mockRequest.mock.calls.find(
    ([m]) => m.type === "results-save",
  )![0].result;
  expect(payload).toMatchObject({
    key: { targetLanguage: "en" },
    source: { kind: "network", url: "https://lrclib.net/old" },
    model: "old-model",
  });
});
it("refreshes settings when returning from the options tab", async () => {
  let configured = false;
  mockRequest.mockImplementation(async (m: any) =>
    m.type === "settings-public"
      ? {
          configured,
          baseUrl: "https://test/v1",
          model: "m",
          settingsRevision: 1,
          sources: [],
          preferences: {
            mode: "original",
            targetLanguage: "zh-Hant",
            fontSize: 28,
            position: "bottom",
          },
        }
      : m.type === "results-list"
        ? []
        : {
            video: {
              schemaVersion: 1,
              videoId: "12345678901",
              title: "test",
              channel: "",
              description: "",
              durationMs: 10000,
            },
            tracks: [],
          },
  );
  render(
    <Panel
      binding={{
        video: document.createElement("video"),
        container: document.createElement("div"),
        videoId: "12345678901",
        isAd: () => false,
      }}
      overlay={{
        beginDraft: vi.fn(),
        setDraftPreview: vi.fn(),
        setResult: vi.fn(),
        stop: vi.fn(),
        destroy: vi.fn(),
      }}
      onClose={() => {}}
    />,
  );
  await screen.findByText(/尚未設定 AI 服務/);
  expect(
    screen
      .getByRole("button", { name: /^AI 找字幕$/ })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "貼入字幕" }));
  expect(
    screen
      .getByRole("button", { name: "使用貼入字幕" })
      .hasAttribute("disabled"),
  ).toBe(false);
  expect(screen.queryByLabelText("匯入 LRC／SRT")).toBeNull();
  fireEvent.change(screen.getByLabelText("字幕全文"), {
    target: { value: "1\n00:00:01,000 --> 00:00:02,000\n本機歌詞" },
  });
  fireEvent.click(screen.getByRole("button", { name: "使用貼入字幕" }));
  await screen.findByRole("heading", { name: "逐句預覽與校時" });
  expect(screen.queryByRole("checkbox", { name: /生成譯文/ })).toBeNull();
  fireEvent.change(screen.getByLabelText("第 1 句開始秒數"), {
    target: { value: "1" },
  });
  fireEvent.change(screen.getByLabelText("第 1 句結束秒數"), {
    target: { value: "2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "套用並保存" }));
  await waitFor(() =>
    expect(
      mockRequest.mock.calls.some(([m]) => m.type === "results-save"),
    ).toBe(true),
  );
  await screen.findByText(/已套用並保存至本機/);
  configured = true;
  fireEvent.focus(window);
  await waitFor(() =>
    expect(screen.queryByText(/尚未設定 AI 服務/)).toBeNull(),
  );
});
it("rejects synthetic page clicks on paid consent", () => {
  const go = vi.fn();
  render(
    <Consent
      title="開始搜尋"
      endpoint="https://ai.test/v1"
      payload={{ title: "song" }}
      onConfirm={go}
      onCancel={() => {}}
    />,
  );
  expect(go).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "開始搜尋" }));
  expect(go).not.toHaveBeenCalled();
});
it("manual timing uses current video position", () => {
  const change = vi.fn();
  render(
    <Editor
      lines={[
        {
          id: "l0",
          original: "歌",
          cueIds: [],
          status: "unaligned",
          excluded: false,
        },
      ]}
      onChange={change}
      currentMs={() => 1234}
      seek={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "以目前位置設開始" }));
  expect(change.mock.calls[0][0][0]).toMatchObject({
    startMs: 1234,
    status: "manual",
  });
});
