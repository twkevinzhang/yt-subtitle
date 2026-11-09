import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Options } from "../../src/options/Options";
const settings = {
  provider: {
    schemaVersion: 1,
    baseUrl: "https://example.com/v1",
    apiToken: "token",
    model: "model",
  },
  preferences: {
    autoSearchApproved: false,
    mode: "original",
    targetLanguage: "zh-Hant",
    fontSize: 28,
    position: "bottom",
  },
};
afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: vi.fn(async (m) => ({
        ok: true,
        data:
          m.type === "settings-edit"
            ? settings
            : m.type === "results-list" || m.type === "cache-list"
              ? []
              : undefined,
      })),
    },
    permissions: { request: vi.fn(async () => true) },
  });
});
test("saves changes across categories and reports a clean state", async () => {
  render(<Options />);
  const save = await screen.findByRole("button", { name: "儲存所有設定" });
  await waitFor(() => expect(save.hasAttribute("disabled")).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "字幕與搜尋" }));
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "36" } });
  expect(screen.getByText("有尚未儲存的變更")).toBeTruthy();
  fireEvent.click(save);
  await waitFor(() => expect(screen.getByText("所有設定已儲存")).toBeTruthy());
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "settings-save",
      preferences: expect.objectContaining({ fontSize: 36 }),
    }),
  );
});

test("opens the category containing an invalid field on save", async () => {
  render(<Options />);
  await screen.findByText("設定已載入");
  fireEvent.change(screen.getByLabelText("Base URL（通常包含 /v1）"), {
    target: { value: "invalid" },
  });
  fireEvent.click(screen.getByRole("button", { name: "本機資料" }));
  fireEvent.click(screen.getByRole("button", { name: "儲存所有設定" }));
  expect(screen.getByRole("region", { name: "AI 服務" })).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("有效的 AI 服務網址");
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "settings-save" }),
  );
});
test("clearing saved results preserves pending subtitle changes and credentials", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<Options />);
  await screen.findByText("設定已載入");
  fireEvent.click(screen.getByRole("button", { name: "字幕與搜尋" }));
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "40" } });
  fireEvent.click(screen.getByRole("button", { name: "本機資料" }));
  fireEvent.click(screen.getByRole("button", { name: "清除全部結果" }));
  await waitFor(() =>
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "results-clear",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "字幕與搜尋" }));
  expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("40");
  fireEvent.click(screen.getByRole("button", { name: "AI 服務" }));
  expect((screen.getByLabelText("API Token") as HTMLInputElement).value).toBe(
    "token",
  );
});

test("lists cached videos and deletes one or all of them", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  let entries = [
    {
      videoId: "aaaaaaaaaaa",
      title: "Song A",
      channel: "Artist",
      durationMs: 213000,
      audioBytes: 6_800_000,
      resultCount: 2,
      lastUsed: Date.now(),
    },
    {
      videoId: "bbbbbbbbbbb",
      title: "",
      channel: "",
      durationMs: 0,
      audioBytes: 0,
      resultCount: 1,
      lastUsed: Date.now(),
    },
  ];
  vi.mocked(chrome.runtime.sendMessage).mockImplementation((async (m: {
    type: string;
    videoId?: string;
  }) => {
    if (m.type === "cache-delete")
      entries = entries.filter((e) => e.videoId !== m.videoId);
    if (m.type === "cache-clear") entries = [];
    return {
      ok: true,
      data:
        m.type === "settings-edit"
          ? settings
          : m.type === "cache-list"
            ? entries
            : m.type === "results-list"
              ? []
              : undefined,
    };
  }) as never);
  render(<Options />);
  await screen.findByText("設定已載入");
  fireEvent.click(screen.getByRole("button", { name: "快取" }));
  expect(screen.getByRole("heading", { name: "快取（2）" })).toBeTruthy();
  expect(screen.getByText("Song A")).toBeTruthy();
  expect(screen.getByText(/Artist · 3:33 · 6\.5 MB · 2 組歌詞/)).toBeTruthy();
  expect(screen.getByText("bbbbbbbbbbb")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "刪除 Song A" }));
  await waitFor(() =>
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "cache-delete",
      videoId: "aaaaaaaaaaa",
    }),
  );
  await screen.findByRole("heading", { name: "快取（1）" });
  fireEvent.click(screen.getByRole("button", { name: "清除全部快取" }));
  await screen.findByRole("heading", { name: "快取（0）" });
  expect(
    (screen.getByRole("button", { name: "清除全部快取" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
