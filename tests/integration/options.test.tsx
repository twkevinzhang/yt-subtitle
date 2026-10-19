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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
