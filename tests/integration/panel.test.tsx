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
afterEach(cleanup);
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
      overlay={{ setResult: vi.fn(), stop: vi.fn(), destroy: vi.fn() }}
      onClose={() => {}}
    />,
  );
  await screen.findByText(/先在設定頁填入/);
  configured = true;
  fireEvent.focus(window);
  await waitFor(() => expect(screen.queryByText(/先在設定頁填入/)).toBeNull());
});
it("does not send until explicit confirmation", () => {
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
  expect(go).toHaveBeenCalledTimes(1);
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
