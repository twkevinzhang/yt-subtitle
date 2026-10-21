import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SearchGroups } from "../../src/ui/SearchGroups";
afterEach(cleanup);
const result = {
  phase: "complete",
  text: "original reply",
  candidates: [],
  requestBody: {
    model: "m",
    input: [{ role: "user", content: "lyrics" }],
    custom: { keep: true },
  },
  endpoint: "responses",
};
it("keeps independent JSON drafts across source tabs and sends only the edited route", () => {
  const resend = vi.fn();
  render(
    <SearchGroups
      snapshot={
        {
          id: "g",
          videoId: "v",
          routes: { configured: result, comments: result, web: result },
        } as any
      }
      onSelect={() => {}}
      onRetry={resend}
    />,
  );
  fireEvent.click(screen.getAllByText("請求內容")[0]);
  fireEvent.click(screen.getByRole("button", { name: "完整 JSON" }));
  const json = screen.getByRole("textbox", { name: "完整 API JSON" });
  fireEvent.change(json, {
    target: { value: '{"model":"edited","custom":{"keep":true}}' },
  });
  fireEvent.click(screen.getByRole("tab", { name: /全網搜尋/ }));
  fireEvent.click(screen.getByRole("tab", { name: /設定的歌詞來源/ }));
  expect(
    (
      screen.getByRole("textbox", {
        name: "完整 API JSON",
      }) as HTMLTextAreaElement
    ).value,
  ).toContain("edited");
  fireEvent.click(screen.getByRole("button", { name: "重新發送此來源" }));
  expect(resend).toHaveBeenCalledWith("configured", {
    model: "edited",
    custom: { keep: true },
  });
});
it("blocks invalid JSON without losing the draft", () => {
  render(
    <SearchGroups
      snapshot={
        {
          id: "g",
          videoId: "v",
          routes: { configured: result, comments: result, web: result },
        } as any
      }
      onSelect={() => {}}
      onRetry={vi.fn()}
    />,
  );
  fireEvent.click(screen.getAllByText("請求內容")[0]);
  fireEvent.click(screen.getByRole("button", { name: "完整 JSON" }));
  fireEvent.change(screen.getByRole("textbox", { name: "完整 API JSON" }), {
    target: { value: '{"model":' },
  });
  expect(screen.getByRole("alert").textContent).toContain("JSON");
  expect(
    (
      screen.getByRole("button", {
        name: "重新發送此來源",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
