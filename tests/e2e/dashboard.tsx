// Isolated UI fixture. Never bundled into the extension.
import React from "react";
import { createRoot } from "react-dom/client";
import { Panel } from "../../src/ui/Panel";
import { SubtitleCoordinator } from "../../src/subtitle/coordinator";
import "../../src/ui/styles.css";
const video = {
  schemaVersion: 1 as const,
  videoId: "abcdefghijk",
  title: "字幕工作台測試影片",
  channel: "測試頻道",
  description: "",
  durationMs: 10000,
};
const settings = {
  configured: true,
  baseUrl: "https://example.test",
  model: "test",
  settingsRevision: 1,
  preferences: {
    autoSearchApproved: true,
    mode: "original" as const,
    targetLanguage: "zh-Hant" as const,
    fontSize: 28,
    position: "bottom" as const,
  },
};
const candidate = {
  schemaVersion: 1 as const,
  id: "timed",
  title: "含時間碼字幕",
  artist: "",
  version: "",
  language: "en",
  sourceId: "lrclib",
  url: "https://lrclib.net",
  fullText: "First line\nSecond line",
  syncedLyrics:
    "1\n00:00:01,000 --> 00:00:02,000\nFirst line\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond line",
  matchReason: "fixture",
  evidence: { status: "verified" as const, citations: [] },
};
const coordinator = new SubtitleCoordinator({
  save: async () => {},
  search: async (_tab, _video, _signal, update) => {
    update({
      id: "s",
      videoId: video.videoId,
      routes: {
        lrclib: { phase: "complete", text: "", candidates: [] },
        comments: {
          phase: "complete",
          text: "",
          candidates: [
            {
              ...candidate,
              id: "untimed",
              sourceId: "comments",
              url: "https://www.youtube.com/watch?v=abcdefghijk",
              syncedLyrics: null,
            },
          ],
        },
        web: { phase: "complete", text: "", candidates: [candidate] },
      },
    });
  },
});
await coordinator.ensure(1, video, 1);
Object.assign(globalThis, {
  chrome: {
    runtime: {
      sendMessage: async (message: {
        type: string;
        source: never;
        mode: "ai" | "paste";
      }) => ({
        ok: true,
        data:
          message.type === "subtitle-entry-mode"
            ? await coordinator.setEntryMode(1, video.videoId, message.mode)
            : message.type === "subtitle-select"
              ? await coordinator.select(1, video.videoId, message.source)
              : message.type === "subtitle-reset"
                ? (coordinator.reset(1), await coordinator.ensure(1, video, 1))
                : coordinator.get(1, video.videoId),
      }),
    },
  },
});
const style = document.createElement("style");
style.textContent =
  ":root{--surface:#0f0f0f;--text:#f1f1f1;--border:#363636;--muted:#aaa;--notice:#14283c;--link:#68b5f7;--button:#272727;--success-text:#a5d6a7;--success-bg:#193321;--error-text:#ffb4ab}body{background:#181818;margin:20px}#root{width:440px;max-width:100%}.subtitle-panel{height:640px}";
document.head.append(style);
const output = document.createElement("p");
output.id = "published-output";
document.body.append(output);
const media = document.createElement("video");
createRoot(document.getElementById("root")!).render(
  <Panel
    binding={{
      video: media,
      container: document.body,
      videoId: video.videoId,
      isAd: () => false,
    }}
    overlay={{
      setCues: (cues) => {
        output.textContent = cues.map((c) => c.text).join("\n");
      },
      stop: () => {
        output.textContent = "";
      },
      destroy: () => {},
    }}
    publicSettings={settings}
    onClose={() => {}}
  />,
);
