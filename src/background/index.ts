import { validateMessage } from "../shared/schemas";
import { authorizeSender } from "./authorization";
import {
  getSettings,
  getPublicSettings,
  saveSettings,
  clearCredentials,
  protectStorage,
  normalizeProvider,
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
import { inspectVideo, readTrack, readTranscript } from "../youtube/context";
import { searchMessages, parseSearchReply } from "../lyrics/search";
import {
  validateAlignment,
  enforceAlignmentOrder,
  type AlignmentDecision,
} from "../lyrics/alignment";
import { prepareAlignmentRetry } from "../lyrics/batches";
import { alignmentRequest } from "../lyrics/alignment-request";
import { authorizeAcousticHost, callAcousticHost } from "./acoustic-host";
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
      // A trusted options-page draft is used only for this request, never saved.
      const provider = normalizeProvider(m.provider);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        return await createAiClient(provider).listModels(controller.signal);
      } finally {
        clearTimeout(timeout);
      }
    }
    case "connection-check": {
      const s = await getSettings();
      if (!s.provider?.model) return { reachable: false };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        await createAiClient(s.provider).listModels(controller.signal);
        return { reachable: true };
      } catch {
        return { reachable: false };
      } finally {
        clearTimeout(timeout);
      }
    }
    case "open-options":
      return chrome.runtime.openOptionsPage();
    case "inspect":
      return inspectVideo(tabId);
    case "read-transcript": {
      const ctx = await inspectVideo(tabId);
      return readTranscript(tabId, ctx.video.videoId);
    }
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
    case "search-test": {
      const s = await getSettings();
      if (!s.provider?.model) throw new Error("請先載入、選擇模型並儲存設定");
      await consent(
        m.consent,
        "search-test",
        { purpose: "search-test", body: m.body },
        s.revision,
      );
      const client = createAiClient(s.provider);
      return runs.start(
        tabId,
        "00000000000",
        s.revision,
        async (tools) =>
          tools.request(() => client.testSearch(m.body, tools.signal)),
        "searching",
      );
    }
    case "search": {
      const s = await getSettings();
      if (!s.provider?.model) throw new Error("請先載入、選擇模型並儲存設定");
      const video = m.video;
      if (video.videoId !== new URL(sender.url!).searchParams.get("v"))
        throw new Error("影片已切換");
      await consent(
        m.consent,
        "search",
        { video, sources: s.sources.filter((x) => x.enabled) },
        s.revision,
      );
      const messages = searchMessages(video, s.sources);
      const client = createAiClient(s.provider);
      return runs.start(
        tabId,
        video.videoId,
        s.revision,
        async (tools) => {
          const result = await tools.request(() =>
            client.searchText(messages, tools.signal),
          );
          return parseSearchReply(result.text, s.sources, result.evidence);
        },
        "searching",
      );
    }
    case "generate": {
      const s = await getSettings();
      if (!s.provider?.model) throw new Error("請先載入、選擇模型並儲存設定");
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
          ...(input.body ? { body: input.body } : {}),
        },
        s.revision,
      );
      const retryLines = prepareAlignmentRetry(input.lines);
      const body =
        input.body ??
        alignmentRequest(s.provider.model, retryLines, input.cues);
      if (JSON.stringify(body).length > 120000)
        throw new Error("內容超過單次請求 120000 字元上限，請縮短內容");
      const client = createAiClient(s.provider);
      return runs.start(
        tabId,
        input.video.videoId,
        s.revision,
        async (tools) => {
          const decisions: AlignmentDecision[] = [];
          const raw = await tools.request(() =>
            client.completeText([], tools.signal, body),
          );
          await tools.response(raw);
          await tools.trace(
            `整首 AI 原始回覆：\n${raw.slice(0, 16000)}${raw.length > 16000 ? "\n［診斷摘要已截斷，完整內容見 AI 原始 response］" : ""}`,
          );
          let payload: unknown;
          try {
            payload = JSON.parse(
              raw.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""),
            );
          } catch {
            throw new Error("AI 校時回覆不是有效 JSON；原文已保留於結果頁");
          }
          let validated: AlignedLine[];
          try {
            validated = validateAlignment(
              payload,
              retryLines,
              input.cues,
              input.video.durationMs,
              decisions,
              false,
            );
          } catch (error) {
            await tools.trace(
              `全曲校驗失敗：${error instanceof Error ? error.message : "格式錯誤"}`,
              true,
            );
            throw error;
          }
          const ordered = enforceAlignmentOrder(validated, decisions);
          await tools.progress(
            ordered.map((line) => line.id),
            ordered,
          );
          const accepted = ordered.filter(
            (line) => !line.excluded && line.startMs !== undefined,
          ).length;
          await tools.trace(
            `全曲校驗：保留 ${accepted} 句；未對齊 ${ordered.filter((line) => !line.excluded && line.startMs === undefined).length} 句。\n逐句判定：\n${JSON.stringify(decisions, null, 2)}`,
            true,
          );
          return { lines: ordered, response: raw };
        },
      );
    }
  }
}
if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target === "acoustic-host") return false;
    if (message?.target === "acoustic-background") {
      void (async () => {
        authorizeAcousticHost(sender);
        if (message.type === "idle") {
          const status = await callAcousticHost("query");
          if (
            !["running", "preparing"].includes(status.phase) &&
            status.modelState === "unloaded"
          )
            await chrome.offscreen.closeDocument();
        }
        // No YouTube default-mode route until acquisition/location gates pass.
        return null;
      })().then(
        (data) => sendResponse({ ok: true, data }),
        (error) => sendResponse({ ok: false, error: String(error.message) }),
      );
      return true;
    }
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
