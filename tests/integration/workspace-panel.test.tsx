import React from "react";
import { it, expect, vi, afterEach, beforeAll } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import "fake-indexeddb/auto";
import { WorkspaceStore } from "../../src/background/workspaces";
import { Panel } from "../../src/ui/Panel";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(async () => {}),
}));
vi.mock("../../src/shared/messages", () => ({ request: mocks.request }));
vi.mock("../../src/ui/use-subtitle-work", () => ({
  useSubtitleWork: () => ({
    start: mocks.start,
    cancel: mocks.cancel,
    busy: false,
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
const video = {
  schemaVersion: 1,
  videoId: "98765432101",
  title: "saved song",
  channel: "artist",
  description: "",
  durationMs: 10000,
};
const settings = {
  configured: true,
  settingsRevision: 1,
  model: "m",
  baseUrl: "https://ai.test",
  sources: [],
  preferences: {
    mode: "original",
    targetLanguage: "ja",
    fontSize: 28,
    position: "bottom",
    alignmentMode: "background",
  },
};
const binding = {
  video: document.createElement("video"),
  container: document.body,
  videoId: video.videoId,
  isAd: () => false,
};
const overlay = {
  beginDraft: vi.fn(),
  setDraftPreview: vi.fn(),
  setResult: vi.fn(),
  stop: vi.fn(),
};
async function setup(withLines = false, empty = false) {
  const store = new WorkspaceStore();
  let workspace = await store.open(video.videoId);
  workspace = await store.reset(video.videoId, workspace.generation);
  const result = {
    phase: "complete",
    text: "original AI reply",
    candidates: [],
    requestBody: { model: "m", input: "lyrics" },
    rawResponse: { output: "original AI reply" },
  };
  if (!empty)
    await store.patch(video.videoId, workspace.generation, {
      search: {
        id: "saved-search",
        videoId: video.videoId,
        routes: { configured: result, comments: result, web: result },
      } as any,
      panel: {
        text: "",
        lines: withLines
          ? [
              {
                id: "a",
                original: "kept lyric",
                cueIds: [],
                status: "manual",
                startMs: 1000,
                endMs: 2000,
                excluded: false,
                timing: {},
              },
            ]
          : [],
        mode: "original",
        offset: 300,
        onlyPending: false,
        runMode: "background",
        resumeView: withLines ? "edit" : "search",
        source: { kind: "web" },
        editors: {
          web: {
            draft: '{"unfinished":',
            original: '{"model":"m","input":"lyrics"}',
            mode: "json",
            open: true,
          },
        },
        activeRoute: "web",
        alignment: {
          phase: "partial",
          checked: [{ startMs: 0, endMs: 10000 }],
          ready: [{ startMs: 1000, endMs: 2000 }],
        },
      },
    });
  mocks.request.mockImplementation(async (m: any) => {
    if (m.type === "workspace-open") return store.open(video.videoId);
    if (m.type === "workspace-save")
      return store.patch(video.videoId, m.generation, { panel: m.panel });
    if (m.type === "workspace-reset")
      return store.reset(video.videoId, m.generation);
    if (m.type === "settings-public") return settings;
    if (m.type === "inspect") return { video, tracks: [] };
    if (m.type === "results-list") return [];
    if (m.type === "search-start") return { id: "fresh" };
    if (m.type === "search-group")
      return {
        id: "fresh",
        videoId: video.videoId,
        routes: { configured: result, comments: result, web: result },
      };
  });
  const mount = () =>
    render(
      <Panel
        binding={binding}
        overlay={overlay as any}
        onClose={() => {}}
        publicSettings={settings as any}
      />,
    );
  return { store, mount };
}
it("restores all sources and an invalid JSON draft, locks the homepage, and survives remount", async () => {
  const { mount, store } = await setup();
  let app = mount();
  const next = await screen.findByRole("button", { name: "繼續" });
  await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
  for (const name of ["AI 找字幕", "YT 字幕", "貼入字幕"])
    expect(
      (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
    ).toBe(true);
  fireEvent.click(next);
  expect(
    (
      screen.getByRole("textbox", {
        name: "完整 API JSON",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe('{"unfinished":');
  fireEvent.change(screen.getByRole("textbox", { name: "完整 API JSON" }), {
    target: { value: '{"edited":' },
  });
  await waitFor(async () =>
    expect((await store.open(video.videoId)).panel?.editors.web?.draft).toBe(
      '{"edited":',
    ),
  );
  app.unmount();
  app = mount();
  fireEvent.click(await screen.findByRole("button", { name: "繼續" }));
  expect(
    (
      (await screen.findByRole("textbox", {
        name: "完整 API JSON",
      })) as HTMLTextAreaElement
    ).value,
  ).toBe('{"edited":');
  expect(
    mocks.request.mock.calls.some(([m]) => m.type === "search-start"),
  ).toBe(false);
});
it("keeps selected lyrics and timing until explicit reload confirmation", async () => {
  const { mount, store } = await setup(true);
  mount();
  await screen.findByRole("button", { name: "繼續" });
  fireEvent.click(screen.getByRole("button", { name: "重新載入" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(document.activeElement?.textContent).toBe("取消");
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(
    ((await store.open(video.videoId)).panel?.lines ?? [])[0].original,
  ).toBe("kept lyric");
  fireEvent.click(screen.getByRole("button", { name: "繼續" }));
  expect(
    (screen.getByLabelText("第 1 句開始秒數") as HTMLInputElement).value,
  ).toBe("1");
  expect(screen.getByText(/已保留校時進度/).textContent).toContain(
    "1 個音訊區段",
  );
  fireEvent.click(screen.getByRole("button", { name: "重新載入" }));
  fireEvent.click(screen.getByRole("button", { name: "清除並重新搜尋" }));
  await waitFor(() =>
    expect(
      mocks.request.mock.calls.filter(([m]) => m.type === "search-start"),
    ).toHaveLength(1),
  );
  expect((await store.open(video.videoId)).panel?.lines ?? []).toEqual([]);
  expect(mocks.cancel).toHaveBeenCalled();
});

it("ignores a manual subtitle read that completes after confirmed reload", async () => {
  const { mount, store } = await setup(false, true);
  const previous = mocks.request.getMockImplementation()!;
  let resolveRead!: (value: unknown) => void;
  mocks.request.mockImplementation((message: any) => {
    if (message.type === "inspect")
      return Promise.resolve({
        video,
        tracks: [
          {
            schemaVersion: 1,
            id: "manual",
            language: "ja",
            label: "Japanese",
            isAuto: false,
            isTranslated: false,
            url: "https://example.com/captions",
          },
        ],
      });
    if (message.type === "read-manual-track")
      return new Promise((resolve) => (resolveRead = resolve));
    return previous(message);
  });
  mount();
  const yt = await screen.findByRole("button", { name: "YT 字幕" });
  await waitFor(() => expect((yt as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(yt);
  await waitFor(() => expect(resolveRead).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "重新載入" }));
  fireEvent.click(screen.getByRole("button", { name: "清除並重新搜尋" }));
  await waitFor(() =>
    expect(
      mocks.request.mock.calls.some(([m]) => m.type === "search-start"),
    ).toBe(true),
  );
  resolveRead([
    { id: "old", text: "must not return", startMs: 1000, endMs: 3000 },
  ]);
  await waitFor(async () =>
    expect((await store.open(video.videoId)).panel?.lines ?? []).toEqual([]),
  );
  expect(screen.queryByLabelText("原文")).toBeNull();
  expect(mocks.start).not.toHaveBeenCalled();
});
