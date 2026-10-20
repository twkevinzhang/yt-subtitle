import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Options } from "../../src/options/Options";
import { defaults, type SettingsRecord } from "../../src/background/settings";
const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock("../../src/shared/messages", () => ({ request: requestMock }));
let record: SettingsRecord;
beforeEach(() => {
  record = structuredClone(defaults);
  requestMock.mockReset();
  requestMock.mockImplementation(async (m) => {
    if (m.type === "settings-edit") return structuredClone(record);
    if (m.type === "results-list") return [];
    if (m.type === "preferences-save") {
      record.preferences = m.preferences;
      return {};
    }
    if (m.type === "settings-save") {
      record = {
        provider: structuredClone(m.provider),
        sources: m.sources,
        preferences: m.preferences,
        revision: record.revision + 1,
      };
      return {};
    }
    if (m.type === "models") return ["model-a", "model-b"];
  });
  vi.stubGlobal("chrome", {
    permissions: { request: vi.fn(async () => true) },
  });
});
it("saves all three timing defaults without configuring AI or requesting permissions", async () => {
  render(<Options />);
  const first = await screen.findByRole("radio", { name: /先緩衝再播放/ });
  expect((first as HTMLInputElement).checked).toBe(true);
  for (const label of [/播放中背景校時/, /整首校完再使用/, /先緩衝再播放/]) {
    fireEvent.click(screen.getByRole("radio", { name: label }));
    fireEvent.click(screen.getByRole("button", { name: "儲存顯示與校時設定" }));
  }
  await waitFor(() =>
    expect(
      requestMock.mock.calls.filter(([m]) => m.type === "preferences-save"),
    ).toHaveLength(3),
  );
  expect(
    requestMock.mock.calls
      .filter(([m]) => m.type === "preferences-save")
      .map(([m]) => m.preferences.alignmentMode),
  ).toEqual(["background", "complete-before-use", "buffer-before-play"]);
  expect(chrome.permissions.request).not.toHaveBeenCalled();
  expect(record.provider).toBeNull();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("expands without sending, submits edited JSON and retains formatted responses when collapsed", async () => {
  record.provider = {
    schemaVersion: 1,
    baseUrl: "https://ai.test/v1",
    apiToken: "test-only-token",
    model: "model-a",
  };
  const fallback = requestMock.getMockImplementation()!;
  let status = 200;
  requestMock.mockImplementation(async (m) => {
    if (m.type === "search-test") return { runId: "test-run" };
    if (m.type === "run")
      return {
        state: { phase: "complete" },
        output: {
          status,
          body: {
            id: "response-id",
            output: [{ type: "message", text: "<img src=x>" }],
          },
        },
      };
    if (m.type === "cancel") return null;
    return fallback(m);
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await open();
  expect(screen.queryByRole("textbox", { name: "Request body" })).toBeNull();
  const toggle = screen.getByRole("button", { name: "測試搜尋（使用額度）" });
  fireEvent.click(toggle);
  const editor = await screen.findByRole("textbox", { name: "Request body" });
  expect(requestMock.mock.calls.some(([m]) => m.type === "search-test")).toBe(
    false,
  );
  const body = JSON.parse((editor as HTMLTextAreaElement).value);
  body.input = "user edited search";
  fireEvent.change(editor, {
    target: { value: JSON.stringify(body, null, 2) },
  });
  fireEvent.click(screen.getByRole("button", { name: "搜尋" }));
  await screen.findByText("Response · HTTP 200");
  expect(
    requestMock.mock.calls.find(([m]) => m.type === "search-test")![0].body,
  ).toEqual(body);
  const response = screen.getByRole("region", { name: "完整 API 回應" });
  expect(response.querySelector("pre")!.textContent).toContain(
    '\n  "id": "response-id"',
  );
  expect(response.querySelector("img")).toBeNull();
  expect(screen.queryByRole("button", { name: "展開" })).toBeNull();
  fireEvent.click(toggle);
  expect(screen.queryByRole("textbox", { name: "Request body" })).toBeNull();
  fireEvent.click(toggle);
  expect(
    (
      screen.getByRole("textbox", {
        name: "Request body",
      }) as HTMLTextAreaElement
    ).value,
  ).toContain("user edited search");
  expect(screen.getByText("Response · HTTP 200")).toBeTruthy();
  status = 400;
  fireEvent.click(screen.getByRole("button", { name: "再次搜尋" }));
  await screen.findByText("Response · HTTP 400");
});
it("keeps invalid JSON and network errors inside the search test section", async () => {
  record.provider = {
    schemaVersion: 1,
    baseUrl: "https://ai.test/v1",
    apiToken: "test-only-token",
    model: "model-a",
  };
  const fallback = requestMock.getMockImplementation()!;
  requestMock.mockImplementation(async (m) => {
    if (m.type === "search-test") return { runId: "test-run" };
    if (m.type === "run")
      return {
        state: { phase: "complete" },
        output: { status: null, body: null, error: "AI 連線失敗" },
      };
    if (m.type === "cancel") return null;
    return fallback(m);
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "測試搜尋（使用額度）" }));
  const editor = screen.getByRole("textbox", { name: "Request body" });
  const valid = (editor as HTMLTextAreaElement).value;
  fireEvent.change(editor, { target: { value: "{" } });
  fireEvent.click(screen.getByRole("button", { name: "搜尋" }));
  const section = screen.getByRole("region", { name: "測試搜尋" });
  expect((await within(section).findByRole("alert")).textContent).toContain(
    "JSON",
  );
  expect(requestMock.mock.calls.some(([m]) => m.type === "search-test")).toBe(
    false,
  );
  fireEvent.change(editor, { target: { value: valid } });
  fireEvent.click(screen.getByRole("button", { name: "搜尋" }));
  await within(section).findByText("Response · 未收到 HTTP 回應");
  expect((await within(section).findByRole("alert")).textContent).toContain(
    "連線失敗",
  );
});
async function open() {
  render(<Options />);
  await screen.findByText("設定保存在這台電腦，不跨裝置同步。");
}
function fillService() {
  fireEvent.change(screen.getByLabelText("Base URL（通常包含 /v1）"), {
    target: { value: "https://ai.test/v1" },
  });
  fireEvent.change(screen.getByLabelText("API Token"), {
    target: { value: "test-only-token" },
  });
}
async function save() {
  fireEvent.click(screen.getByRole("button", { name: "儲存設定" }));
  await waitFor(() => expect(record.provider).not.toBeNull());
}
it("places CF below credentials and replaces the free-text model with a load button", async () => {
  await open();
  expect(screen.queryByRole("textbox", { name: "模型名稱" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "模型清單" })).toBeNull();
  expect(screen.getByRole("button", { name: "載入模型" })).toBeTruthy();
  const token = screen.getByLabelText("API Token");
  const cf = screen.getByText("Cloudflare Access（選填，ID 與 Secret 成對）");
  expect(
    token.compareDocumentPosition(cf) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
it("loads models from unsaved credentials and persists only after explicit save", async () => {
  await open();
  fillService();
  expect(record.provider).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "載入模型" }));
  const select = await screen.findByRole("combobox", { name: "模型清單" });
  expect((select as HTMLSelectElement).value).toBe("");
  expect(record.provider).toBeNull();
  expect(requestMock).toHaveBeenCalledWith({
    type: "models",
    provider: {
      schemaVersion: 1,
      baseUrl: "https://ai.test/v1",
      apiToken: "test-only-token",
      model: "",
    },
  });
  fireEvent.change(select, { target: { value: "model-b" } });
  fireEvent.click(screen.getByRole("button", { name: "儲存設定" }));
  await waitFor(() => expect(record.provider?.model).toBe("model-b"));
  expect(screen.queryByRole("textbox", { name: "模型名稱" })).toBeNull();
});
it("shows model connection failures inside the AI section and allows retry", async () => {
  await open();
  fillService();
  await save();
  requestMock.mockImplementation(async (m) => {
    if (m.type === "models") throw new Error("AI 服務回應 HTTP 403");
  });
  fireEvent.click(screen.getByRole("button", { name: "載入模型" }));
  const alert = await screen.findByRole("alert");
  expect(alert.closest("section")?.getAttribute("aria-label")).toBe("AI 服務");
  expect(alert.textContent).toContain("403");
  expect(
    (screen.getByRole("button", { name: "載入模型" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  expect(screen.queryByRole("combobox", { name: "模型清單" })).toBeNull();
});
it("clears model choices when credentials change and never loads against stale saved credentials", async () => {
  await open();
  fillService();
  await save();
  fireEvent.click(screen.getByRole("button", { name: "載入模型" }));
  fireEvent.change(await screen.findByRole("combobox", { name: "模型清單" }), {
    target: { value: "model-a" },
  });
  fireEvent.change(screen.getByLabelText("API Token"), {
    target: { value: "new-test-token" },
  });
  expect(screen.queryByRole("combobox", { name: "模型清單" })).toBeNull();
  expect(
    (screen.getByRole("button", { name: "載入模型" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "載入模型" }));
  await screen.findByRole("combobox", { name: "模型清單" });
  const calls = requestMock.mock.calls.filter(([m]) => m.type === "models");
  expect(calls).toHaveLength(2);
  expect(calls[1][0].provider.apiToken).toBe("new-test-token");
  expect(record.provider?.apiToken).toBe("test-only-token");
});
it("puts source and display validation errors in their own section", async () => {
  await open();
  fillService();
  fireEvent.change(screen.getByLabelText("來源網域"), {
    target: { value: "bad/path" },
  });
  fireEvent.click(screen.getByRole("button", { name: "儲存設定" }));
  const source = screen.getByRole("region", { name: "歌詞來源" });
  expect((await within(source).findByRole("alert")).textContent).toContain(
    "來源",
  );
  fireEvent.change(screen.getByLabelText("來源網域"), {
    target: { value: "lrclib.net" },
  });
  fireEvent.change(screen.getByLabelText("字級（14–64 px）"), {
    target: { value: "100" },
  });
  fireEvent.click(screen.getByRole("button", { name: "儲存全部設定" }));
  const display = screen.getByRole("region", { name: "字幕顯示" });
  expect((await within(display).findByRole("alert")).textContent).toContain(
    "字級",
  );
  expect(requestMock.mock.calls.some(([m]) => m.type === "settings-save")).toBe(
    false,
  );
});
it("keeps a saved model selected when reopening without making an automatic model request", async () => {
  record.provider = {
    schemaVersion: 1,
    baseUrl: "https://ai.test/v1",
    apiToken: "test-only-token",
    model: "model-a",
  };
  await open();
  expect(
    (screen.getByRole("combobox", { name: "模型清單" }) as HTMLSelectElement)
      .value,
  ).toBe("model-a");
  expect(requestMock.mock.calls.some(([m]) => m.type === "models")).toBe(false);
  expect(
    (
      screen.getByRole("button", {
        name: "測試搜尋（使用額度）",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});
it("reports invalid URLs and incomplete CF credentials in the AI section without saving", async () => {
  await open();
  fillService();
  const ai = screen.getByRole("region", { name: "AI 服務" });
  fireEvent.change(screen.getByLabelText("Base URL（通常包含 /v1）"), {
    target: { value: "not-a-url" },
  });
  fireEvent.click(screen.getByRole("button", { name: "儲存設定" }));
  expect((await within(ai).findByRole("alert")).textContent).toContain("網址");
  fireEvent.change(screen.getByLabelText("Base URL（通常包含 /v1）"), {
    target: { value: "https://ai.test/v1" },
  });
  fireEvent.click(
    screen.getByText("Cloudflare Access（選填，ID 與 Secret 成對）"),
  );
  fireEvent.change(screen.getByLabelText("Cloudflare Client ID"), {
    target: { value: "test-client.access" },
  });
  fireEvent.click(screen.getByRole("button", { name: "儲存設定" }));
  expect((await within(ai).findByRole("alert")).textContent).toContain("成對");
  expect(requestMock.mock.calls.some(([m]) => m.type === "settings-save")).toBe(
    false,
  );
});
it("reports an empty model list locally and supports retrying", async () => {
  await open();
  fillService();
  await save();
  requestMock.mockResolvedValueOnce([]);
  fireEvent.click(screen.getByRole("button", { name: "載入模型" }));
  const ai = screen.getByRole("region", { name: "AI 服務" });
  expect((await within(ai).findByRole("alert")).textContent).toContain(
    "沒有提供",
  );
  fireEvent.click(screen.getByRole("button", { name: "載入模型" }));
  await screen.findByRole("combobox", { name: "模型清單" });
  expect(within(ai).queryByRole("alert")).toBeNull();
});
it("prevents editing credentials and source drafts while a model request is in flight", async () => {
  await open();
  fillService();
  await save();
  let finish!: (models: string[]) => void;
  requestMock.mockImplementationOnce(
    () =>
      new Promise<string[]>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "載入模型" }));
  expect(
    (screen.getByLabelText("API Token") as HTMLInputElement).disabled,
  ).toBe(true);
  expect((screen.getByLabelText("來源網域") as HTMLInputElement).disabled).toBe(
    true,
  );
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  finish(["model-a"]);
  await screen.findByRole("combobox", { name: "模型清單" });
  expect(
    (screen.getByLabelText("API Token") as HTMLInputElement).disabled,
  ).toBe(false);
});

it("does not send credentials when the user denies the connection permission", async () => {
  await open();
  fillService();
  vi.mocked(chrome.permissions.request).mockImplementationOnce(
    async () => false,
  );
  fireEvent.click(screen.getByRole("button", { name: "載入模型" }));
  expect((await screen.findByRole("alert")).textContent).toContain("未授予");
  expect(
    requestMock.mock.calls.some(
      ([m]) => m.type === "models" || m.type === "settings-save",
    ),
  ).toBe(false);
  expect(record.provider).toBeNull();
});
it("validates the current draft before requesting permission or models", async () => {
  await open();
  fillService();
  fireEvent.change(screen.getByLabelText("Base URL（通常包含 /v1）"), {
    target: { value: "invalid-url" },
  });
  fireEvent.click(screen.getByRole("button", { name: "載入模型" }));
  expect((await screen.findByRole("alert")).textContent).toContain("網址");
  expect(chrome.permissions.request).not.toHaveBeenCalled();
  expect(requestMock.mock.calls.some(([m]) => m.type === "models")).toBe(false);
});
