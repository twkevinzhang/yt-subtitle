import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Panel } from "../../src/ui/Panel";
const mock = vi.hoisted(() => ({
  request: vi.fn(),
  acquire: vi.fn(async () => "asset"),
}));
vi.mock("../../src/shared/messages", () => ({ request: mock.request }));
vi.mock("../../src/ui/user-action", () => ({ isUserAction: () => true }));
vi.mock("../../src/acoustic/contracts", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  acousticEnabled: () => true,
}));
vi.mock("../../src/acoustic/youtube-audio-source", () => ({
  acquireYouTubeAudio: mock.acquire,
}));
afterEach(cleanup);
it("uses acquired audio and region requests, previews the first verified segment and preserves pending lines", async () => {
  const video = document.createElement("video");
  Object.defineProperty(video, "duration", { value: 10 });
  const settings = {
    configured: true,
    model: "m",
    baseUrl: "https://test/v1",
    settingsRevision: 1,
    sources: [],
    preferences: {
      mode: "original",
      targetLanguage: "ja",
      fontSize: 28,
      position: "bottom",
    },
  };
  const source = ["first", "pending"].map((original, i) => ({
    id: "l" + i,
    original,
    cueIds: [],
    excluded: false,
    status: "unaligned",
  }));
  const snapshot = {
    key: { runId: "r", tabId: 1, videoId: "12345678901", draftRevision: 1 },
    sequence: 1,
    lines: [{ ...source[0], startMs: 1000, endMs: 2000 }, source[1]],
    segments: { s: "verified" },
    modelState: "ready",
  };
  let complete = false;
  mock.request.mockImplementation(async (m) => {
    if (m.type === "settings-public") return settings;
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
    if (m.type === "results-list") return [];
    if (m.type === "read-transcript")
      return [{ id: "c0", text: "first", startMs: 1000, endMs: 2000 }];
    if (m.type === "generate") return { runId: "r" };
    if (m.type === "run")
      return {
        state: {
          phase: complete ? "complete" : "aligning",
          completedLineIds: ["l0"],
          requestCount: 1,
        },
        acoustic: snapshot,
        output: { lines: snapshot.lines, response: "{}" },
      };
  });
  const overlay = {
    beginDraft: vi.fn(),
    setDraftPreview: vi.fn(),
    setResult: vi.fn(),
    stop: vi.fn(),
  };
  render(
    <Panel
      binding={{
        video,
        container: document.body,
        videoId: "12345678901",
        isAd: () => false,
      }}
      overlay={overlay as any}
      onClose={() => {}}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "貼上歌詞" }));
  fireEvent.change(screen.getByLabelText("歌詞全文"), {
    target: { value: "first\npending" },
  });
  fireEvent.click(screen.getByRole("button", { name: "使用貼上歌詞" }));
  await waitFor(() => expect(overlay.setDraftPreview).toHaveBeenCalled());
  const sent = mock.request.mock.calls.find(([m]) => m.type === "generate")![0];
  expect(sent.input.audioAssetId).toBe("asset");
  expect(sent.input.body.messages[0].content).toContain("companions");
  expect(screen.getByLabelText("逐句時間戳").textContent).toContain("pending");
  expect(
    screen.getByRole("button", { name: "套用並保存" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(overlay.setResult).not.toHaveBeenCalled();
  expect(
    (screen.getAllByLabelText("原文")[0] as HTMLTextAreaElement).disabled,
  ).toBe(true);
  complete = true;
  await screen.findByText(
    "已校時 1 句，另有 1 句待處理；已完成片段可播放，完整保存仍需處理待校時句。",
  );
  fireEvent.change(screen.getAllByLabelText("原文")[0], {
    target: { value: "edited first" },
  });
  expect(
    (screen.getByLabelText("Request body") as HTMLTextAreaElement).value,
  ).toBe("");
  expect(overlay.stop).toHaveBeenCalled();
});
