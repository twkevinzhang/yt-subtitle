import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Panel } from "../../src/ui/Panel";
const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }));
vi.mock("../../src/shared/messages", () => ({ request: mockRequest }));
vi.mock("../../src/ui/user-action", () => ({ isUserAction: () => true }));
afterEach(cleanup);
it("locates pending lyrics and keeps apply unavailable until they are resolved", async () => {
  setup();
  const original = mockRequest.getMockImplementation()!;
  mockRequest.mockImplementation((m: any) =>
    m.type === "run"
      ? Promise.resolve({
          state: {
            phase: "complete",
            completedLineIds: ["l0", "l1"],
            requestCount: 1,
          },
          output: {
            lines: [
              {
                id: "l0",
                original: "已對齊",
                startMs: 1000,
                endMs: 2000,
                status: "anchor",
                cueIds: ["c0"],
                excluded: false,
              },
              {
                id: "l1",
                original: "待處理歌詞",
                status: "unaligned",
                cueIds: [],
                excluded: false,
              },
            ],
            response: "{}",
          },
        })
      : original(m),
  );
  fireEvent.click(await screen.findByRole("button", { name: "貼上歌詞" }));
  fireEvent.change(screen.getByLabelText("歌詞全文"), {
    target: { value: "已對齊\n待處理歌詞" },
  });
  fireEvent.click(screen.getByRole("button", { name: "使用貼上歌詞" }));
  await screen.findByText("AI 對齊完成，請檢查後套用並保存。");
  expect(
    screen.getByRole("tab", { name: "歌詞結果" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(
    screen.getByRole("button", { name: "套用並保存" }).hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "檢查問題" }));
  expect(screen.getByLabelText("逐句時間戳").textContent).not.toContain(
    "已對齊",
  );
  expect(screen.getByLabelText("逐句時間戳").textContent).toContain(
    "待處理歌詞",
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "排除這句" }));
  expect(
    screen.getByRole("button", { name: "套用並保存" }).hasAttribute("disabled"),
  ).toBe(false);
});
function setup(onClose = vi.fn()) {
  const settings = {
    configured: true,
    model: "m",
    baseUrl: "https://test/v1",
    settingsRevision: 1,
    sources: [{ enabled: true, name: "來源", domain: "example.com" }],
    preferences: {
      mode: "original",
      targetLanguage: "ja",
      fontSize: 28,
      position: "bottom",
    },
  };
  const aligned = [
    {
      id: "l0",
      original: "歌詞",
      status: "anchor",
      cueIds: ["c0"],
      startMs: 1000,
      endMs: 2000,
      excluded: false,
    },
  ];
  mockRequest.mockReset();
  mockRequest.mockImplementation(async (m: any) => {
    if (m.type === "settings-public") return settings;
    if (m.type === "results-list") return [];
    if (m.type === "inspect")
      return {
        video: {
          schemaVersion: 1,
          videoId: "12345678901",
          title: "song",
          channel: "",
          description: "",
          durationMs: 10000,
        },
        tracks: [],
      };
    if (m.type === "read-transcript")
      return [{ id: "c0", text: "歌詞", startMs: 1000, endMs: 2000 }];
    if (m.type === "generate") return { runId: "r" };
    if (m.type === "run")
      return {
        state: { phase: "complete", completedLineIds: ["l0"], requestCount: 1 },
        output: { lines: aligned, response: '{"lines":[]}' },
      };
  });
  const overlay = { setResult: vi.fn(), stop: vi.fn(), destroy: vi.fn() };
  render(
    <Panel
      binding={{
        video: document.createElement("video"),
        container: document.createElement("div"),
        videoId: "12345678901",
        isAd: () => false,
      }}
      overlay={overlay}
      onClose={onClose}
    />,
  );
  return overlay;
}
it("separates search, paste and import entry pages", async () => {
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "AI 尋找歌詞" }));
  expect(screen.getByRole("button", { name: "開始搜尋" })).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "歌詞全文" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "← 返回歌詞" }));
  fireEvent.click(screen.getByRole("button", { name: "貼上歌詞" }));
  expect(screen.getByRole("textbox", { name: "歌詞全文" })).toBeTruthy();
  expect(screen.queryByLabelText("匯入 LRC／SRT")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "← 返回歌詞" }));
  fireEvent.click(screen.getByRole("button", { name: "匯入 LRC／SRT" }));
  expect(screen.getByLabelText("匯入 LRC／SRT")).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "歌詞全文" })).toBeNull();
});
it("aligns paste immediately, edits the real request, and applies only on explicit save", async () => {
  const overlay = setup();
  fireEvent.click(await screen.findByRole("button", { name: "貼上歌詞" }));
  fireEvent.change(screen.getByLabelText("歌詞全文"), {
    target: { value: "歌詞" },
  });
  fireEvent.click(screen.getByRole("button", { name: "使用貼上歌詞" }));
  fireEvent.click(await screen.findByRole("tab", { name: "請求內容" }));
  const body = await screen.findByRole("textbox", { name: "Request body" });
  await waitFor(() =>
    expect(
      mockRequest.mock.calls.filter(([m]) => m.type === "generate"),
    ).toHaveLength(1),
  );
  await screen.findByText("AI 對齊完成，請檢查後套用並保存。");
  expect(overlay.setResult).not.toHaveBeenCalled();
  expect(mockRequest.mock.calls.some(([m]) => m.type === "results-save")).toBe(
    false,
  );
  expect((body as HTMLTextAreaElement).value).toContain('\n  "model"');
  fireEvent.change(body, { target: { value: "{bad" } });
  fireEvent.click(screen.getByRole("button", { name: "重新請求" }));
  await screen.findByRole("alert");
  expect(
    mockRequest.mock.calls.filter(([m]) => m.type === "generate"),
  ).toHaveLength(1);
  const edited = {
    model: "custom-model",
    messages: [{ role: "user", content: "校時" }],
    stream: false,
  };
  fireEvent.change(body, { target: { value: JSON.stringify(edited) } });
  fireEvent.click(screen.getByRole("button", { name: "重新請求" }));
  await waitFor(() =>
    expect(
      mockRequest.mock.calls.filter(([m]) => m.type === "generate"),
    ).toHaveLength(2),
  );
  expect(
    mockRequest.mock.calls.filter(([m]) => m.type === "generate").at(-1)![0]
      .input.body,
  ).toEqual(edited);
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "套用並保存" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "套用並保存" }));
  await waitFor(() => expect(overlay.setResult).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "製作／編輯" })).toBeTruthy(),
  );
});
it("previews imported timestamps before sending and keeps local timed import usable without AI", async () => {
  const overlay = setup();
  fireEvent.click(await screen.findByRole("button", { name: "匯入 LRC／SRT" }));
  const file = {
    name: "song.srt",
    size: 60,
    arrayBuffer: async () =>
      new TextEncoder().encode("1\n00:00:01,000 --> 00:00:02,000\n歌詞").buffer,
  };
  fireEvent.change(screen.getByLabelText("匯入 LRC／SRT"), {
    target: { files: [file] },
  });
  await screen.findByText("song.srt · 1 句");
  expect(mockRequest.mock.calls.some(([m]) => m.type === "generate")).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "確認並開始對齊" }));
  await screen.findByText("AI 對齊完成，請檢查後套用並保存。");
  expect(
    mockRequest.mock.calls.filter(([m]) => m.type === "generate"),
  ).toHaveLength(1);
  expect(overlay.setResult).not.toHaveBeenCalled();
});
it("keeps the previous result and edited body after a retry fails", async () => {
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "貼上歌詞" }));
  fireEvent.change(screen.getByLabelText("歌詞全文"), {
    target: { value: "歌詞" },
  });
  fireEvent.click(screen.getByRole("button", { name: "使用貼上歌詞" }));
  await screen.findByText("AI 對齊完成，請檢查後套用並保存。");
  const old = mockRequest.getMockImplementation()!;
  mockRequest.mockImplementation((m: any) =>
    m.type === "generate"
      ? Promise.reject(new Error("AI 服務回應 HTTP 503"))
      : old(m),
  );
  fireEvent.click(screen.getByRole("tab", { name: "請求內容" }));
  const body = screen.getByLabelText("Request body") as HTMLTextAreaElement;
  const edited = body.value.replace('"model": "m"', '"model": "retry"');
  fireEvent.change(body, { target: { value: edited } });
  fireEvent.click(screen.getByRole("button", { name: "重新請求" }));
  await screen.findByText("AI 服務回應 HTTP 503");
  expect(body.value).toBe(edited);
  expect(screen.getByLabelText("逐句時間戳").textContent).toContain(
    "00:01–00:02",
  );
  expect(
    screen.getByRole("button", { name: "套用並保存" }).hasAttribute("disabled"),
  ).toBe(false);
});

it.each([
  ["← 返回歌詞", "取消工作並返回"],
  ["取消工作", "取消工作"],
  ["關閉面板", "取消工作並關閉"],
])(
  "confirms %s while waiting and ignores a late response",
  async (trigger, confirmLabel) => {
    const close = vi.fn();
    setup(close);
    let finish!: (value: any) => void;
    const old = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((m: any) =>
      m.type === "run"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : old(m),
    );
    fireEvent.click(await screen.findByRole("button", { name: "貼上歌詞" }));
    fireEvent.change(screen.getByLabelText("歌詞全文"), {
      target: { value: "歌詞" },
    });
    fireEvent.click(screen.getByRole("button", { name: "使用貼上歌詞" }));
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    fireEvent.click(screen.getByRole("button", { name: trigger }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeTruthy();
    expect(document.activeElement?.textContent).toBe("繼續等待");
    expect(mockRequest.mock.calls.some(([m]) => m.type === "cancel")).toBe(
      false,
    );
    fireEvent.click(within(dialog).getByRole("button", { name: confirmLabel }));
    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith({ type: "cancel", runId: "r" }),
    );
    finish({
      state: { phase: "complete", completedLineIds: ["l0"], requestCount: 1 },
      output: {
        lines: [
          {
            id: "l0",
            original: "不應出現的晚到結果",
            startMs: 1000,
            endMs: 2000,
            status: "anchor",
            cueIds: [],
            excluded: false,
          },
        ],
        response: "late",
      },
    });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.queryByText("不應出現的晚到結果")).toBeNull();
    expect(close).toHaveBeenCalledTimes(trigger === "關閉面板" ? 1 : 0);
    if (trigger === "← 返回歌詞")
      expect(screen.getByRole("button", { name: "繼續編輯草稿" })).toBeTruthy();
  },
);
it("continues waiting when cancellation is dismissed", async () => {
  setup();
  const old = mockRequest.getMockImplementation()!;
  mockRequest.mockImplementation((m: any) =>
    m.type === "run" ? new Promise(() => {}) : old(m),
  );
  fireEvent.click(await screen.findByRole("button", { name: "貼上歌詞" }));
  fireEvent.change(screen.getByLabelText("歌詞全文"), {
    target: { value: "歌詞" },
  });
  fireEvent.click(screen.getByRole("button", { name: "使用貼上歌詞" }));
  await waitFor(() =>
    expect(mockRequest.mock.calls.some(([m]) => m.type === "run")).toBe(true),
  );
  fireEvent.click(screen.getByRole("button", { name: "← 返回歌詞" }));
  fireEvent.click(screen.getByRole("button", { name: "繼續等待" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(mockRequest.mock.calls.some(([m]) => m.type === "cancel")).toBe(false);
  expect(screen.getByRole("tab", { name: "歌詞結果" })).toBeTruthy();
});

it("does not leave when cancellation fails and permits retry", async () => {
  setup();
  const old = mockRequest.getMockImplementation()!;
  let rejectCancel = true;
  mockRequest.mockImplementation((m: any) =>
    m.type === "run"
      ? new Promise(() => {})
      : m.type === "cancel" && rejectCancel
        ? Promise.reject(new Error("offline"))
        : old(m),
  );
  fireEvent.click(await screen.findByRole("button", { name: "貼上歌詞" }));
  fireEvent.change(screen.getByLabelText("歌詞全文"), {
    target: { value: "歌詞" },
  });
  fireEvent.click(screen.getByRole("button", { name: "使用貼上歌詞" }));
  await waitFor(() =>
    expect(mockRequest.mock.calls.some(([m]) => m.type === "run")).toBe(true),
  );
  fireEvent.click(screen.getByRole("button", { name: "← 返回歌詞" }));
  fireEvent.click(screen.getByRole("button", { name: "取消工作並返回" }));
  await screen.findByText(/無法確認取消/);
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  rejectCancel = false;
  fireEvent.click(screen.getByRole("button", { name: "取消工作並返回" }));
  await screen.findByRole("button", { name: "繼續編輯草稿" });
});
it("cancels while loading captions without dispatching a later AI request", async () => {
  setup();
  const old = mockRequest.getMockImplementation()!;
  let finishCaptions!: (value: any) => void;
  mockRequest.mockImplementation((m: any) =>
    m.type === "read-transcript"
      ? new Promise((resolve) => {
          finishCaptions = resolve;
        })
      : old(m),
  );
  fireEvent.click(await screen.findByRole("button", { name: "貼上歌詞" }));
  fireEvent.change(screen.getByLabelText("歌詞全文"), {
    target: { value: "歌詞" },
  });
  fireEvent.click(screen.getByRole("button", { name: "使用貼上歌詞" }));
  await waitFor(() => expect(finishCaptions).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "← 返回歌詞" }));
  fireEvent.click(screen.getByRole("button", { name: "取消工作並返回" }));
  await screen.findByRole("button", { name: "繼續編輯草稿" });
  finishCaptions([{ id: "c0", startMs: 1000, endMs: 2000, text: "歌詞" }]);
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(mockRequest.mock.calls.some(([m]) => m.type === "generate")).toBe(
    false,
  );
});
