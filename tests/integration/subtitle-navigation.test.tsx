import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import { Panel } from "../../src/ui/Panel";
import { initialJob } from "../../src/subtitle/job-state";
const mocks = vi.hoisted(() => ({
  mode: vi.fn(async (_mode: "ai" | "paste") => {}),
  cancel: vi.fn(async () => {}),
  select: vi.fn(async () => {}),
}));
vi.mock("../../src/ui/use-subtitle-work", () => ({
  useSubtitleWork: () => ({
    work: {
      version: 2,
      video: { videoId: "abcdefghijk", title: "song", durationMs: 10000 },
      job: initialJob({
        tabId: 1,
        videoId: "abcdefghijk",
        generation: 1,
        sourceFingerprint: "",
      }),
    },
    setEntryMode: mocks.mode,
    cancel: mocks.cancel,
    select: mocks.select,
    reset: vi.fn(),
  }),
}));
afterEach(cleanup);
it("shows mutually exclusive source pages and preserves pasted text when going back", async () => {
  render(
    <Panel
      binding={{ videoId: "abcdefghijk" } as never}
      overlay={{} as never}
      onClose={() => {}}
      publicSettings={
        {
          configured: true,
          preferences: { autoSearchApproved: true },
          sources: [],
        } as never
      }
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "貼入字幕" }));
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "字幕原文或 SRT" }),
    ).toBeTruthy(),
  );
  expect(screen.queryByRole("group", { name: "選擇字幕" })).toBeNull();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "保留這段原文" },
  });
  fireEvent.click(screen.getByRole("button", { name: /上一步/ }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "AI 取得字幕" })).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "AI 取得字幕" }));
  await waitFor(() =>
    expect(screen.getByRole("group", { name: "選擇字幕" })).toBeTruthy(),
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /上一步/ }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "貼入字幕" })).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "貼入字幕" }));
  await waitFor(() =>
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "保留這段原文",
    ),
  );
  expect(mocks.mode.mock.calls.map((call) => call[0])).toEqual([
    "paste",
    "ai",
    "paste",
  ]);
});
