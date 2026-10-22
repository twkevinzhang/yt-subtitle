import React, { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { SourceSettingsEditor } from "../../src/options/SourceSettingsEditor";
import type { SourceSettings } from "../../src/shared/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function Harness() {
  const [sources, setSources] = useState<SourceSettings[]>([]);
  return (
    <>
      <SourceSettingsEditor
        sources={sources}
        onChange={setSources}
        disabled={false}
      />
      <output role="note">{JSON.stringify(sources)}</output>
    </>
  );
}
test("pasting requests metadata but only adds the edited name after confirmation", async () => {
  vi.stubGlobal("chrome", {
    permissions: { request: vi.fn(async () => false) },
  });
  render(<Harness />);
  fireEvent.paste(screen.getByLabelText("網站網址或網域"), {
    clipboardData: { getData: () => "https://www.example.org/music?q=hi" },
  });
  await screen.findByRole("button", { name: "新增來源" });
  expect(screen.getByRole("status").textContent).toContain("權限");
  expect(screen.getByRole("status").textContent).not.toContain("正在");
  expect(screen.getByRole("status").textContent).toContain("預設圖示");
  expect(screen.getByRole("status").closest("section")).toBeTruthy();
  expect(
    screen.getByRole("status").ownerDocument.querySelector("output")!
      .textContent,
  ).toBe("[]");
  fireEvent.change(screen.getByLabelText("顯示名稱"), {
    target: { value: "我的歌詞庫" },
  });
  fireEvent.click(screen.getByRole("button", { name: "新增來源" }));
  expect(screen.getByText("我的歌詞庫", { exact: true })).toBeTruthy();
  expect(screen.getByText("example.org", { exact: true })).toBeTruthy();
  expect(
    JSON.parse(
      screen.getByRole("status").ownerDocument.querySelector("output")!
        .textContent!,
    )[0],
  ).toMatchObject({ domain: "example.org", name: "我的歌詞庫", enabled: true });
  fireEvent.click(
    screen.getByRole("button", { name: "修改 我的歌詞庫 的名稱" }),
  );
  fireEvent.change(screen.getByLabelText("來源顯示名稱"), {
    target: { value: "新名稱" },
  });
  fireEvent.click(screen.getByRole("button", { name: "完成修改" }));
  expect(screen.getByText("新名稱", { exact: true })).toBeTruthy();
});
test("rejects duplicate hostnames even when the input has www and a path", async () => {
  render(
    <SourceSettingsEditor
      sources={[
        {
          schemaVersion: 1,
          id: "1",
          name: "Lyrics",
          domain: "example.org",
          enabled: true,
          includeSubdomains: false,
        },
      ]}
      onChange={vi.fn()}
      disabled={false}
    />,
  );
  fireEvent.change(screen.getByLabelText("網站網址或網域"), {
    target: { value: "www.example.org/song" },
  });
  fireEvent.click(screen.getByRole("button", { name: "辨識網站" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("已在來源列表"),
  );
});
test("an older website lookup cannot overwrite a newer pasted website", async () => {
  let finishFirst!: (value: boolean) => void;
  vi.stubGlobal("chrome", {
    permissions: {
      request: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<boolean>((resolve) => {
              finishFirst = resolve;
            }),
        )
        .mockResolvedValue(false),
    },
  });
  render(<Harness />);
  const input = screen.getByLabelText("網站網址或網域");
  fireEvent.paste(input, { clipboardData: { getData: () => "first.org" } });
  fireEvent.paste(input, { clipboardData: { getData: () => "second.org" } });
  await screen.findByRole("button", { name: "新增來源" });
  await act(async () => {
    finishFirst(false);
  });
  expect((screen.getByLabelText("顯示名稱") as HTMLInputElement).value).toBe(
    "second.org",
  );
  expect(screen.queryByText("first.org", { exact: true })).toBeNull();
});
