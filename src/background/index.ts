import { validateMessage } from "../shared/schemas";
import { authorizeSender } from "./authorization";
import {
  getSettings,
  getPublicSettings,
  saveSettings,
  clearCredentials,
  protectStorage,
} from "./settings";
import { createAiClient } from "./ai-client";
import { RunManager, type RunRecord } from "./runs";
import { RunJournal } from "./run-journal";
import {
  hashInput,
  saveResult,
  listResults,
  deleteResult,
  clearResults,
  resultSchema,
} from "./results";
import { inspectVideo, readTrack } from "../youtube/context";
import { searchMessages, validateCandidates } from "../lyrics/search";
import { alignmentMessages, validateAlignment } from "../lyrics/alignment";
import { makeBatches } from "../lyrics/batches";
import type { ConsentReceipt, AlignedLine } from "../shared/types";
const journal = new RunJournal({
  get: () => chrome.storage.session.get(null),
  set: (v) => chrome.storage.session.set(v),
  remove: (k) => chrome.storage.session.remove(k),
});
const persist = (r: RunRecord) => journal.persist(r);
const runs = new RunManager(persist);
let initialized: Promise<void> | undefined;
async function init() {
  return (initialized ??= (async () => {
    await protectStorage();
    await journal.restore();
  })());
}
async function consent(
  receipt: ConsentReceipt,
  purpose: ConsentReceipt["purpose"],
  value: unknown,
  revision: number,
) {
  if (
    receipt.purpose !== purpose ||
    receipt.settingsRevision !== revision ||
    Date.now() - receipt.confirmedAt > 600000 ||
    receipt.confirmedAt > Date.now() + 5000 ||
    receipt.inputHash !== (await hashInput(value))
  )
    throw new Error("資料或設定已改變，請重新確認傳送內容");
}
export async function handleMessage(
  raw: unknown,
  sender: chrome.runtime.MessageSender,
) {
  const m = validateMessage(raw),
    ownOptions = authorizeSender(m.type, sender, chrome.runtime.id);
  await init();
  const tabId = sender.tab?.id ?? -1;
  switch (m.type) {
    case "settings-public":
      return getPublicSettings();
    case "settings-edit":
      return getSettings();
    case "settings-save":
      runs.cancelAll();
      return saveSettings(m.provider, m.sources, m.preferences);
    case "clear-credentials":
      runs.cancelAll();
      return clearCredentials();
    case "models": {
      const s = await getSettings();
      if (!s.provider) throw new Error("請先儲存服務設定");
      return createAiClient(s.provider).listModels(
        new AbortController().signal,
      );
    }
    case "open-options":
      return chrome.runtime.openOptionsPage();
    case "inspect":
      return inspectVideo(tabId);
    case "read-track": {
      const ctx = await inspectVideo(tabId);
      if (!ctx.tracks.some((t) => t.id === m.trackId))
        throw new Error("字幕軌不存在");
      return readTrack(tabId, m.trackId, ctx.video.videoId);
    }
    case "results-list":
      return listResults(
        ownOptions ? m.videoId : new URL(sender.url!).searchParams.get("v")!,
      );
    case "results-save": {
      const r = resultSchema.parse(m.result);
      if (
        !ownOptions &&
        r.key.videoId !== new URL(sender.url!).searchParams.get("v")
      )
        throw new Error("影片已切換");
      return saveResult(r);
    }
    case "results-delete":
      return deleteResult(m.key as any);
    case "results-clear":
      return clearResults();
    case "run": {
      const r =
        runs.get(m.runId) ||
        (await chrome.storage.session.get("run:" + m.runId))["run:" + m.runId];
      if (r && r.state.tabId !== tabId) throw new Error("工作不屬於此分頁");
      return r ?? null;
    }
    case "cancel": {
      const r = runs.get(m.runId);
      if (r && r.state.tabId === tabId) runs.cancel(m.runId);
      return null;
    }
    case "search-test":
    case "search": {
      const s = await getSettings();
      if (!s.provider) throw new Error("請先設定 AI 服務");
      const video =
        m.type === "search"
          ? m.video
          : {
              schemaVersion: 1 as const,
              videoId: "00000000000",
              title:
                "搜尋測試：查詢 LRCLIB 官方說明並回傳可核對來源；不要編造歌詞",
              channel: "",
              description: "",
              durationMs: 0,
            };
      if (
        m.type === "search" &&
        video.videoId !== new URL(sender.url!).searchParams.get("v")
      )
        throw new Error("影片已切換");
      await consent(
        m.consent,
        m.type === "search" ? "search" : "search-test",
        m.type === "search"
          ? { video, sources: s.sources.filter((x) => x.enabled) }
          : { purpose: "search-test" },
        s.revision,
      );
      const messages = searchMessages(video, s.sources);
      const client = createAiClient(s.provider);
      return runs.start(
        tabId,
        video.videoId,
        s.revision,
        async (tools) => {
          const response = await tools.request(() =>
            client.completeJson(messages, tools.signal),
          );
          return m.type === "search-test"
            ? response.evidence
            : validateCandidates(
                response.payload,
                s.sources,
                response.evidence,
              );
        },
        "searching",
      );
    }
    case "generate": {
      const s = await getSettings();
      if (!s.provider) throw new Error("請先設定 AI 服務");
      const input = m.input;
      if (input.video.videoId !== new URL(sender.url!).searchParams.get("v"))
        throw new Error("影片已切換");
      await consent(
        input.consent,
        "generate",
        {
          video: input.video,
          lines: input.lines,
          cues: input.cues,
          targetLanguage: input.targetLanguage,
          translate: input.translate,
        },
        s.revision,
      );
      const batches = makeBatches(input.lines, input.cues);
      if (
        batches.length > 20 ||
        batches.some((b) => JSON.stringify(b).length > 120000)
      )
        throw new Error("內容超過本次處理上限，請減少歌詞或使用手動校時");
      const client = createAiClient(s.provider);
      return runs.start(
        tabId,
        input.video.videoId,
        s.revision,
        async (tools) => {
          let completed: AlignedLine[] = [];
          let lastStart = -1;
          for (const batch of batches) {
            const response = await tools.request(() =>
              client.completeJson(
                alignmentMessages(batch, input.targetLanguage, input.translate),
                tools.signal,
              ),
            );
            const lines = validateAlignment(
              response.payload,
              batch.lines,
              batch.cues,
              input.video.durationMs,
            );
            for (const line of lines) {
              if (
                line.startMs !== undefined &&
                line.startMs < lastStart &&
                line.status !== "manual"
              ) {
                line.startMs = undefined;
                line.endMs = undefined;
                line.status = "unaligned";
                line.cueIds = [];
              }
              if (line.startMs !== undefined) lastStart = line.startMs;
            }
            if (input.translate && lines.some((l) => !l.translation?.trim()))
              throw new Error("部分譯文缺漏，已保留完成段落");
            completed = [...completed, ...lines];
            await tools.progress(
              lines.map((l) => l.id),
              completed,
            );
          }
          return completed;
        },
      );
    }
  }
}
if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    void handleMessage(message, sender).then(
      (data) => sendResponse({ ok: true, data }),
      (error) =>
        sendResponse({
          ok: false,
          error:
            error instanceof Error && error.name !== "ZodError"
              ? error.message
              : "資料格式不符，請重新操作",
        }),
    );
    return true;
  });
  chrome.action.onClicked.addListener(() => {
    void chrome.runtime.openOptionsPage();
  });
  chrome.tabs.onRemoved.addListener((id) => runs.cancelTab(id));
  chrome.tabs.onUpdated.addListener((id, change) => {
    if (change.url) runs.cancelTab(id);
  });
  void init();
}
