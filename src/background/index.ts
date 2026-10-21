import { validateMessage } from "../shared/schemas";
import { authorizeSender } from "./authorization";
import {
  getSettings,
  getPublicSettings,
  saveSettings,
  clearCredentials,
  protectStorage,
  normalizeProvider,
  savePreferences,
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
  parseRevisedSubtitles,
  revisedSubtitleRequest,
} from "../lyrics/revised-subtitles";
import { authorizeAcousticHost, callAcousticHost } from "./acoustic-host";
import type { ConsentReceipt, AlignedLine } from "../shared/types";
import { AudioUploads, AudioStaging } from "./audio-uploads";
import type { JobKey } from "../acoustic/contracts";
import { startSearchGroup, type SearchGroupSnapshot } from "./search-group";
import { readManualTrack, readComments } from "../youtube/context";
import { workspaces, interruptedSearch } from "./workspaces";
import type { WorkspacePanel } from "../shared/workspace";
import { createPoTokenClient } from "./po-token-client";
import { authorizePoTokenRequest } from "./po-token-authorization";
const poTokenClient = createPoTokenClient();
const poTokenRequests = new Map<
  string,
  { tabId: number; controller: AbortController }
>();
function cancelPoTokens(tabId: number) {
  for (const [id, work] of poTokenRequests)
    if (work.tabId === tabId) {
      work.controller.abort();
      poTokenRequests.delete(id);
    }
}
const searchGroups = new Map<
  string,
  {
    tabId: number;
    videoId: string;
    controller: AbortController;
    snapshot?: SearchGroupSnapshot;
    video: import("../shared/types").VideoContext;
    retries: Map<string, AbortController>;
    generation: string;
    persistence: Promise<void>;
  }
>();
function persistSearch(
  group: NonNullable<ReturnType<typeof searchGroups.get>>,
) {
  const snapshot = structuredClone(group.snapshot);
  if (!snapshot) return;
  group.persistence = group.persistence
    .then(async () => {
      await workspaces.patch(group.videoId, group.generation, {
        search: snapshot,
        video: group.video,
      });
    })
    .catch((error) => {
      if (group.snapshot)
        group.snapshot.storageError = String(
          error instanceof Error ? error.message : error,
        );
    });
}
async function restoreSearch(id: string, tabId: number, videoId: string) {
  const existing = searchGroups.get(id);
  if (existing?.videoId === videoId) return existing;
  if (existing) throw Error("搜尋工作已中斷");
  const workspace = await workspaces.open(videoId);
  const concurrent = searchGroups.get(id);
  if (concurrent?.videoId === videoId) return concurrent;
  if (workspace.search?.id !== id || !workspace.video)
    throw Error("搜尋工作已中斷");
  const group = {
    tabId,
    videoId,
    video: workspace.video,
    snapshot: interruptedSearch(workspace.search),
    controller: new AbortController(),
    retries: new Map<string, AbortController>(),
    generation: workspace.generation,
    persistence: Promise.resolve(),
  };
  searchGroups.set(id, group);
  return group;
}
function cancelSearches(tabId: number) {
  for (const [id, group] of searchGroups)
    if (group.tabId === tabId) {
      group.controller.abort();
      group.retries.forEach((c) => c.abort());
      searchGroups.delete(id);
    }
}
let localOwner:
  { key: JobKey; timer: ReturnType<typeof setTimeout> } | undefined;
async function stopLocal(tabId: number) {
  const owner = localOwner;
  if (!owner || owner.key.tabId !== tabId) return;
  await callAcousticHost("local-cancel", { key: owner.key });
  if (localOwner === owner) {
    clearTimeout(owner.timer);
    localOwner = undefined;
  }
}
import {
  stageJobAudio,
  clearJobAudio,
  deleteJobAudio,
} from "../acoustic/audio-store";
import { prepareAcousticAudio } from "./acoustic-host";
import {
  followAcousticJob,
  recoveryOwner,
  fillMissingTimings,
  followMissingTimingJob,
} from "./acoustic-jobs";
const uploads = new AudioUploads();
const staged = new AudioStaging(deleteJobAudio);
async function dropTabAudio(tabId: number) {
  uploads.clearTab(tabId);
  await staged.clearTab(tabId);
}
const journal = new RunJournal({
  get: () => chrome.storage.session.get(null),
  set: (v) => chrome.storage.session.set(v),
  remove: (k) => chrome.storage.session.remove(k),
});
const persist = (r: RunRecord) => journal.persist(r);
const runs = new RunManager(persist, () => uploads.isBusy || staged.isBusy);
let initialized: Promise<void> | undefined;
async function init() {
  return (initialized ??= (async () => {
    await protectStorage();
    const previous = await chrome.storage.session.get(null);
    await journal.restore();
    // Reconcile only an already existing host. Never restart an AI request.
    const contexts = chrome.runtime.getContexts
      ? await chrome.runtime.getContexts({
          contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
          documentUrls: [chrome.runtime.getURL("offscreen.html")],
        })
      : [];
    if (contexts.length) {
      const local = await callAcousticHost("local-status");
      if (local?.key)
        await callAcousticHost("local-cancel", { key: local.key });
      const status = await callAcousticHost("query");
      const key = status.key ?? status.snapshot?.key;
      const candidate =
        key && (previous["run:" + key.runId] as RunRecord | undefined);
      const record = await recoveryOwner(
        status,
        candidate,
        async (owner) => {
          try {
            const tab = await chrome.tabs.get(owner.tabId);
            return new URL(tab.url!).searchParams.get("v") === owner.videoId;
          } catch {
            return false;
          }
        },
        async (owner) => {
          await callAcousticHost("cancel", { key: owner });
          const deadline = Date.now() + 6500;
          while (
            ["running", "preparing"].includes(
              (await callAcousticHost("query")).phase,
            )
          ) {
            if (Date.now() >= deadline)
              throw new Error("舊聲學工作尚未停止，請稍後重試");
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        },
      );
      if (record) {
        record.acoustic =
          status.phase === "preparing" || record.timingSource
            ? undefined
            : status.snapshot;
        runs.adopt(record, async (tools) => ({
          lines: record.timingSource
            ? await followMissingTimingJob(
                key,
                record.timingSource,
                tools,
                callAcousticHost,
              )
            : await followAcousticJob(key, tools, callAcousticHost),
          response: record.responseText ?? "",
        }));
      }
    }
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
    case "po-token-get": {
      const tabId = authorizePoTokenRequest(
        m.videoId,
        sender,
        chrome.runtime.id,
      );
      if (poTokenRequests.has(m.requestId) || poTokenRequests.size >= 10)
        throw Error("Token 請求已存在或過多");
      const work = { tabId, controller: new AbortController() };
      poTokenRequests.set(m.requestId, work);
      try {
        return await poTokenClient.get(m.videoId, work.controller.signal);
      } finally {
        if (poTokenRequests.get(m.requestId) === work)
          poTokenRequests.delete(m.requestId);
      }
    }
    case "po-token-cancel": {
      const tabId = authorizePoTokenRequest(
        m.videoId,
        sender,
        chrome.runtime.id,
      );
      const work = poTokenRequests.get(m.requestId);
      if (work?.tabId === tabId) {
        work.controller.abort();
        poTokenRequests.delete(m.requestId);
      }
      return null;
    }
    case "workspace-open": {
      const videoId = new URL(sender.url!).searchParams.get("v")!;
      const groups = [...searchGroups.values()].filter(
        (g) => g.videoId === videoId,
      );
      await Promise.all(groups.map((g) => g.persistence));
      let workspace = await workspaces.open(videoId);
      if (
        workspace.search &&
        !groups.some((g) => g.snapshot?.id === workspace.search!.id)
      )
        workspace = await workspaces.patch(videoId, workspace.generation, {
          search: interruptedSearch(workspace.search),
        });
      if (!workspace.panel && !workspace.search && !workspace.reset) {
        const saved = (await listResults(videoId))[0];
        if (saved) {
          const settings = await getSettings();
          workspace = await workspaces.patch(videoId, workspace.generation, {
            panel: {
              text: "",
              lines: saved.lines as import("../shared/types").SubtitleLine[],
              source: saved.subtitleSource ?? { kind: "legacy" },
              provenance: {
                source: saved.source,
                model: saved.model,
                targetLanguage: saved.key.targetLanguage,
              },
              mode: "original",
              offset: saved.offsetMs,
              onlyPending: false,
              runMode:
                settings.preferences.alignmentMode ?? "buffer-before-play",
              resumeView: "edit",
              editors: {},
              activeRoute: "configured",
            },
          });
        }
      }
      return workspace;
    }
    case "workspace-save": {
      const videoId = new URL(sender.url!).searchParams.get("v")!;
      return workspaces.savePanel(
        videoId,
        m.generation,
        m.panel as WorkspacePanel,
        m.baseline as WorkspacePanel | undefined,
        {
          fields: m.fields as (keyof WorkspacePanel)[] | undefined,
          editorRoutes: m.editorRoutes,
        },
      );
    }
    case "workspace-reset": {
      const videoId = new URL(sender.url!).searchParams.get("v")!;
      const current = await workspaces.open(videoId);
      if (current.generation !== m.generation)
        throw Error("工作資料已改變，請重新開啟面板確認");
      for (const [id, group] of searchGroups)
        if (group.videoId === videoId && group.generation === m.generation) {
          group.controller.abort();
          group.retries.forEach((c) => c.abort());
          searchGroups.delete(id);
        }
      await stopLocal(tabId);
      runs.cancelTab(tabId);
      return workspaces.reset(videoId, m.generation);
    }
    case "preferences-save":
      return savePreferences(m.preferences);
    case "search-start": {
      const settings = await getSettings();
      if (!settings.provider?.model) throw new Error("請先設定 AI 服務");
      if (m.video.videoId !== new URL(sender.url!).searchParams.get("v"))
        throw new Error("影片已切換");
      await consent(
        m.consent,
        "search",
        { video: m.video, sources: settings.sources.filter((s) => s.enabled) },
        settings.revision,
      );
      const workspace = await workspaces.open(m.video.videoId);
      if (m.generation && workspace.generation !== m.generation)
        throw Error("工作資料已重新載入，舊搜尋已取消");
      if (workspace.search) return { id: workspace.search.id };
      const active = [...searchGroups.values()].find(
        (group) =>
          group.videoId === m.video.videoId &&
          group.generation === workspace.generation,
      );
      if (active?.snapshot) return { id: active.snapshot.id };
      if (workspace.panel?.lines.length || workspace.panel?.text.trim())
        throw Error("此影片已有工作資料，請使用繼續或重新載入");
      cancelSearches(tabId);
      const id = crypto.randomUUID(),
        group = {
          tabId,
          video: m.video,
          generation: workspace.generation,
          persistence: Promise.resolve(),
          retries: new Map<string, AbortController>(),
          videoId: m.video.videoId,
          controller: new AbortController(),
          snapshot: undefined as SearchGroupSnapshot | undefined,
        };
      searchGroups.set(id, group);
      const finished = new Set<string>();
      void startSearchGroup(
        m.video,
        settings,
        group.controller.signal,
        (snapshot) => {
          if (!group.snapshot) group.snapshot = { ...snapshot, id };
          for (const route of ["configured", "comments", "web"] as const) {
            if (finished.has(route)) continue;
            group.snapshot.routes[route] = snapshot.routes[route];
            if (snapshot.routes[route].phase !== "pending") finished.add(route);
          }
          persistSearch(group);
        },
        undefined,
        (signal) => readComments(tabId, m.video.videoId, signal),
        undefined,
        (route, controller) => {
          group.retries.set(route, controller);
          return () => {
            if (group.retries.get(route) === controller)
              group.retries.delete(route);
          };
        },
      ).catch(() => {});
      await group.persistence;
      return { id };
    }
    case "search-route-retry":
    case "search-route-cancel": {
      const group = await restoreSearch(
        m.id,
        tabId,
        new URL(sender.url!).searchParams.get("v")!,
      );
      if (
        !group?.snapshot ||
        group.videoId !== new URL(sender.url!).searchParams.get("v")
      )
        throw new Error("搜尋工作已中斷");
      if (m.type === "search-route-cancel") {
        group.retries.get(m.route)?.abort();
        return;
      }
      if (
        group.retries.has(m.route) ||
        group.snapshot.routes[m.route].phase === "pending"
      )
        throw new Error("此來源仍在處理中");
      const controller = new AbortController();
      group.retries.set(m.route, controller);
      try {
        const settings = await getSettings();
        if (searchGroups.get(m.id) !== group || controller.signal.aborted)
          throw new Error("搜尋工作已中斷");
        if (!settings.provider?.model) throw new Error("請先設定 AI 服務");
        await startSearchGroup(
          group.video,
          settings,
          controller.signal,
          (snapshot) => {
            if (group.snapshot)
              group.snapshot.routes[m.route] = snapshot.routes[m.route];
            persistSearch(group);
          },
          undefined,
          (signal) => readComments(tabId, group.videoId, signal),
          { onlyRoute: m.route, body: m.body, previous: group.snapshot },
        );
        await group.persistence;
        return group.snapshot.routes[m.route];
      } finally {
        group.retries.delete(m.route);
      }
    }
    case "search-group":
    case "search-cancel": {
      const group = await restoreSearch(
        m.id,
        tabId,
        new URL(sender.url!).searchParams.get("v")!,
      );
      if (
        !group ||
        group.videoId !== new URL(sender.url!).searchParams.get("v")
      )
        throw new Error("搜尋工作已中斷");
      if (m.type === "search-cancel") {
        group.controller.abort();
        group.retries.forEach((c) => c.abort());
      }
      await group.persistence;
      return group.snapshot;
    }
    case "read-manual-track":
      return readManualTrack(
        tabId,
        m.trackId,
        new URL(sender.url!).searchParams.get("v")!,
      );
    case "local-model": {
      const videoId = new URL(sender.url!).searchParams.get("v");
      if (m.input.key.videoId !== videoId) throw new Error("影片已切換");
      const key = { ...m.input.key, tabId };
      if (
        runs.isBusy ||
        (localOwner &&
          (localOwner.key.tabId !== tabId ||
            localOwner.key.runId !== key.runId ||
            localOwner.key.draftRevision !== key.draftRevision))
      )
        throw new Error("已有本機工作正在處理");
      if (!localOwner) {
        if (m.input.operation !== "prepare")
          throw new Error("模型工作已中斷，請重新補時");
        localOwner = {
          key,
          timer: setTimeout(() => {
            void stopLocal(tabId).catch(() => {});
          }, 600000),
        };
      }
      if (m.input.assetId) staged.claim(m.input.assetId, tabId, videoId!);
      try {
        return await callAcousticHost("local-infer", {
          input: { ...m.input, key },
        });
      } finally {
        if (m.input.assetId) await deleteJobAudio(m.input.assetId);
      }
    }
    case "local-model-cancel": {
      if (localOwner && localOwner.key.runId !== m.key.runId)
        throw new Error("本機工作已更換");
      await stopLocal(tabId);
      await dropTabAudio(tabId);
      return null;
    }
    case "audio-begin":
      await staged.expire();
      if (
        runs.isBusy ||
        staged.isBusy ||
        (localOwner && localOwner.key.tabId !== tabId)
      )
        throw new Error("已有工作正在處理，請先取消或等待完成");
      return uploads.begin(tabId, new URL(sender.url!).searchParams.get("v")!);
    case "audio-chunk":
      uploads.append(
        m.assetId,
        tabId,
        new URL(sender.url!).searchParams.get("v")!,
        m.sequence,
        m.base64,
      );
      return null;
    case "audio-finish": {
      const videoId = new URL(sender.url!).searchParams.get("v")!;
      const data = uploads.finish(m.assetId, tabId, videoId);
      // A cold host clears orphan assets, so prepare it before writing.
      await staged.put(m.assetId, tabId, videoId, () =>
        stageJobAudio(m.assetId, data, prepareAcousticAudio),
      );
      return null;
    }
    case "audio-clear":
      await dropTabAudio(tabId);
      return null;
    case "acoustic-position": {
      const record = runs.get(m.runId);
      if (
        record?.state.tabId !== tabId ||
        record.state.videoId !== new URL(sender.url!).searchParams.get("v") ||
        record.state.phase !== "aligning"
      )
        return null;
      record.positionMs = m.timeMs;
      if (!record.acoustic) return null;
      return callAcousticHost("position", {
        key: record.acoustic.key,
        timeMs: m.timeMs,
      });
    }
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
      if (localOwner) throw new Error("已有本機工作正在處理");
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
          ...(input.timingOnly ? { timingOnly: true } : {}),
          ...(input.audioAssetId ? { audioAssetId: input.audioAssetId } : {}),
          ...(input.positionMs !== undefined
            ? { positionMs: input.positionMs }
            : {}),
        },
        s.revision,
      );
      const retryLines = input.lines;
      const body =
        input.body ??
        revisedSubtitleRequest(s.provider.model, retryLines, input.cues);
      if (JSON.stringify(body).length > 120000)
        throw new Error("內容超過單次請求 120000 字元上限，請縮短內容");
      const client = createAiClient(s.provider);
      if (input.audioAssetId) {
        if (runs.isBusy)
          throw new Error("已有工作正在處理，請先取消或等待完成");
        if (!input.timingOnly) throw new Error("音訊只用於補齊缺少的時間");
        if (
          new TextEncoder().encode(JSON.stringify(input.lines)).length > 60000
        )
          throw new Error("歌詞過長，超過分段工作暫存上限");
        staged.claim(input.audioAssetId, tabId, input.video.videoId);
        return runs.start(
          tabId,
          input.video.videoId,
          s.revision,
          async (tools) => {
            const record = runs.get(tools.runId)!;
            record.positionMs = Math.min(
              input.video.durationMs,
              input.positionMs ?? 0,
            );
            try {
              record.timingSource = retryLines;
              await persist(record);
              return await fillMissingTimings(
                {
                  key: {
                    runId: tools.runId,
                    tabId,
                    videoId: input.video.videoId,
                    draftRevision: s.revision,
                  },
                  assetId: input.audioAssetId!,
                  lines: retryLines,
                  cues: input.cues,
                  durationMs: input.video.durationMs,
                  positionMs: record.positionMs,
                },
                tools,
                {
                  host: callAcousticHost,
                },
              );
            } finally {
              await clearJobAudio();
            }
          },
        );
      }
      if (input.timingOnly) throw new Error("缺少供本機補時的音訊");
      return runs.start(
        tabId,
        input.video.videoId,
        s.revision,
        async (tools) => {
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
          const revised = parseRevisedSubtitles(
            payload,
            input.video.durationMs,
          );
          await tools.progress(
            revised
              .filter((l) => l.startMs !== undefined && l.endMs !== undefined)
              .map((l) => l.id),
            revised,
          );
          return { lines: revised, response: raw };
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
            status.modelState === "unloaded" &&
            !staged.isBusy &&
            !uploads.isBusy &&
            !runs.isBusy
          )
            await chrome.offscreen.closeDocument();
        }
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
  chrome.tabs.onRemoved.addListener((id) => {
    cancelPoTokens(id);
    cancelSearches(id);
    void stopLocal(id).catch(() => {});
    runs.cancelTab(id);
    void dropTabAudio(id);
  });
  chrome.tabs.onUpdated.addListener((id, change) => {
    if (change.url) {
      cancelPoTokens(id);
      cancelSearches(id);
      void stopLocal(id).catch(() => {});
      runs.cancelTab(id);
      void dropTabAudio(id);
    }
  });
  void init();
}
