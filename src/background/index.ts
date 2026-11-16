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
  saveTranslation,
} from "./settings";
import { createAiClient } from "./ai-client";
import { inspectVideo, readComments } from "../youtube/context";
import { startSearchGroup } from "./search-group";
import { parseSearchReply } from "../lyrics/search";
import { commentMessages, parseCommentReply } from "../youtube/comments";
import { searchLrclib } from "../lyrics/lrclib";
import { TEST_VIDEO } from "../lyrics/test-video";
import type { LyricSearchResult, SearchHttpResult } from "../shared/types";
import { SubtitleCoordinator } from "../subtitle/coordinator";
import { hashInput, listResults, deleteResult, clearResults } from "./results";
import type { RunRecord } from "./runs";
import { audioProvider } from "../subtitle/audio-provider";
import { runInHost, initializeHost } from "../subtitle/host-client";
import { subtitleCache, resultCacheKey } from "../subtitle/cache-store";
import {
  translationMessages,
  parseTranslation,
  translateInChunks,
} from "../lyrics/translate";
import {
  translationCacheKey,
  getCachedTranslation,
  putCachedTranslation,
  clearCachedTranslations,
} from "./translation-cache";
const hostStartup =
  typeof chrome !== "undefined"
    ? initializeHost().then(
        () => null,
        (error) => error,
      )
    : Promise.resolve(null);
const testRuns = new Map<string, RunRecord>();
const coordinator = new SubtitleCoordinator({
  align: async (video, lyrics, language, signal, progress, tabId) => {
    // Same video + lyrics + language + library release always aligns the same.
    const cacheKey = await resultCacheKey({
      videoId: video.videoId,
      durationMs: video.durationMs,
      lyrics,
      language,
    });
    void subtitleCache
      .describe(video.videoId, {
        title: video.title,
        channel: video.channel,
        durationMs: video.durationMs,
      })
      .catch(() => {});
    const hit = await subtitleCache.getResult(cacheKey).catch(() => undefined);
    if (hit) return hit;
    const startupError = await hostStartup;
    if (startupError) throw startupError;
    // Languages the model cannot align are rejected by runUntimed before any
    // model work, so the gate lives next to the supported list, not here.
    // The host prepares the speech model while the audio is still loading.
    const acquisition = new AbortController();
    const stop = () => acquisition.abort(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
    const audio = audioProvider.acquire(
      video.videoId,
      video.durationMs / 1000,
      acquisition.signal,
      tabId,
    );
    audio.catch(() => {});
    let result;
    try {
      result = await runInHost(audio, lyrics, language, signal, progress);
    } finally {
      signal.removeEventListener("abort", stop);
      acquisition.abort();
    }
    await subtitleCache
      .putResult(cacheKey, video.videoId, result)
      .catch(() => {});
    return result;
  },
  translate: async (lines, language, signal) => {
    const settings = await getSettings();
    if (!settings.provider?.model) throw Error("請先設定 AI 服務");
    const prompt = settings.preferences.translation?.prompt;
    const key = await translationCacheKey({
      lines,
      language,
      prompt,
      model: settings.provider.model,
    });
    const hit = await getCachedTranslation(key).catch(() => undefined);
    if (hit?.length === lines.length) return hit;
    const client = createAiClient(settings.provider);
    const result = await translateInChunks(
      lines,
      async (chunk, context, chunkSignal) =>
        parseTranslation(
          await client.completeText(
            translationMessages(prompt, language, chunk, context),
            chunkSignal,
          ),
          chunk.length,
        ),
      signal,
    );
    await putCachedTranslation(key, result).catch(() => {});
    return result;
  },
  search: async (tabId, video, signal, update) => {
    if (testTabs.has(tabId)) throw Error("測試分頁不會自動搜尋");
    const settings = await getSettings();
    if (!settings.provider?.model || !settings.preferences.autoSearchApproved)
      throw Error("請先在設定頁允許影片載入時自動搜尋字幕。");
    return startSearchGroup(video, settings, signal, update, undefined, (s) =>
      readComments(tabId, video.videoId, s),
    );
  },
  retrySearch: async (tabId, video, route, previous, signal, update) => {
    if (testTabs.has(tabId)) throw Error("測試分頁不會自動搜尋");
    const settings = await getSettings();
    if (!settings.provider?.model || !settings.preferences.autoSearchApproved)
      throw Error("請先允許自動搜尋");
    return startSearchGroup(
      video,
      settings,
      signal,
      update,
      undefined,
      (s) => readComments(tabId, video.videoId, s),
      { onlyRoute: route, previous },
    );
  },
  save: async (tabId, work) => {
    await chrome.storage.local.set({ ["subtitle-v2:" + tabId]: work });
  },
});
async function snapshot(tabId: number, videoId: string) {
  const settings = await getSettings();
  const active = coordinator.get(tabId, videoId);
  const aiAllowed =
    !!settings.provider?.model && !!settings.preferences.autoSearchApproved;
  if (
    active?.settingsRevision === settings.revision &&
    (aiAllowed || active.entryMode === "paste")
  )
    return active;
  const saved = (await chrome.storage.local.get("subtitle-v2:" + tabId))[
    "subtitle-v2:" + tabId
  ];
  if (
    saved?.version === 2 &&
    saved.video?.videoId === videoId &&
    saved.settingsRevision === settings.revision &&
    (aiAllowed || saved.entryMode === "paste")
  ) {
    try {
      coordinator.restore(tabId, saved);
    } catch {
      return null;
    }
  }
  const restored = coordinator.get(tabId, videoId);
  return restored && (aiAllowed || restored.entryMode === "paste")
    ? restored
    : null;
}
async function ensure(tabId: number, videoId: string) {
  const context = await inspectVideo(tabId);
  if (context.video.videoId !== videoId) throw Error("影片已切換");
  const settings = await getSettings();
  if (!settings.provider?.model || !settings.preferences.autoSearchApproved)
    throw Error("請先設定 AI 服務並允許自動搜尋。");
  if (!coordinator.get(tabId, videoId)) {
    const saved = (await chrome.storage.local.get("subtitle-v2:" + tabId))[
      "subtitle-v2:" + tabId
    ];
    if (
      saved?.version === 2 &&
      saved.video?.videoId === videoId &&
      saved.settingsRevision === settings.revision
    ) {
      try {
        coordinator.restore(tabId, saved);
      } catch {
        /* Malformed storage never becomes playable. */
      }
    }
  }
  return coordinator.ensure(tabId, context.video, settings.revision);
}
// Tabs opened by a search test; they must never start a paid search of their own.
const testTabs = new Set<number>();
async function readTestComments(signal: AbortSignal) {
  const tab = await chrome.tabs.create({
    url: `https://www.youtube.com/watch?v=${TEST_VIDEO.videoId}`,
    active: false,
  });
  const id = tab.id!;
  testTabs.add(id);
  try {
    await new Promise<void>((resolve, reject) => {
      const done = (fn: () => void) => {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        fn();
      };
      const listener = (tabId: number, info: { status?: string }) => {
        if (tabId === id && info.status === "complete") done(resolve);
      };
      const timer = setTimeout(
        () => done(() => reject(new Error("影片頁載入逾時"))),
        30000,
      );
      chrome.tabs.onUpdated.addListener(listener);
      void chrome.tabs.get(id).then((t) => {
        if (t.status === "complete") done(resolve);
      });
    });
    return await readComments(id, TEST_VIDEO.videoId, signal);
  } finally {
    await chrome.tabs.remove(id).catch(() => {});
    testTabs.delete(id);
  }
}
const failed = (error: unknown, fallback: string): LyricSearchResult => ({
  text: "",
  candidates: [],
  error: error instanceof Error ? error.message : fallback,
});
/** Runs the three searches exactly as the panel does, but keeps nothing: no saved result, no cache. */
async function searchTest(
  client: ReturnType<typeof createAiClient>,
  body: Record<string, unknown>,
  commentsPrompt?: string,
): Promise<SearchHttpResult> {
  const lrclib = searchLrclib(TEST_VIDEO, AbortSignal.timeout(30000)).catch(
    (e) => failed(e, "LRCLIB 連線失敗"),
  );
  const comments = (async (): Promise<LyricSearchResult> => {
    const signal = AbortSignal.timeout(120000);
    const batch = await readTestComments(signal);
    const reply = await client.inspectRequest(
      "chat/completions",
      client.requestBody(
        commentMessages(TEST_VIDEO, batch, commentsPrompt),
        false,
      ),
      signal,
    );
    if (reply.error)
      return { text: reply.text, candidates: [], error: reply.error };
    const result = parseCommentReply(reply.text, batch);
    result.candidates = result.candidates.filter(
      (c) => new URL(c.url).searchParams.get("v") === TEST_VIDEO.videoId,
    );
    return result;
  })().catch((e) => failed(e, "留言搜尋失敗"));
  try {
    const response = await client.inspectRequest(
      "responses",
      body,
      AbortSignal.timeout(120000),
    );
    return {
      status: response.httpStatus,
      body: response.rawResponse,
      ...(response.error ? { error: response.error } : {}),
      result: response.error
        ? { text: response.text, candidates: [], error: response.error }
        : parseSearchReply(response.text, response.evidence, "web"),
      lrclib: await lrclib,
      comments: await comments,
    };
  } catch (error) {
    return {
      status: null,
      body: null,
      error: error instanceof Error ? error.message : "AI 連線失敗",
      lrclib: await lrclib,
      comments: await comments,
    };
  }
}

export async function handleMessage(
  raw: unknown,
  sender: chrome.runtime.MessageSender,
) {
  const m = validateMessage(raw),
    ownOptions = authorizeSender(m.type, sender, chrome.runtime.id);
  await protectStorage();
  const tabId = sender.tab?.id ?? -1,
    videoId = ownOptions ? "" : new URL(sender.url!).searchParams.get("v")!;
  switch (m.type) {
    case "subtitle-ensure":
      return ensure(tabId, videoId);
    case "subtitle-snapshot":
      return snapshot(tabId, videoId);
    case "subtitle-entry-mode": {
      if (!coordinator.get(tabId, videoId)) {
        if (m.mode === "ai") await ensure(tabId, videoId);
        else {
          const context = await inspectVideo(tabId),
            settings = await getSettings();
          if (context.video.videoId !== videoId) throw Error("影片已切換");
          await coordinator.ensure(
            tabId,
            context.video,
            settings.revision,
            false,
          );
        }
      }
      return coordinator.setEntryMode(tabId, videoId, m.mode);
    }
    case "subtitle-select": {
      const settings = await getSettings(),
        work = coordinator.get(tabId, videoId);
      if (!work || work.settingsRevision !== settings.revision)
        throw Error("設定已變更，請重新載入字幕工作");
      return coordinator.select(tabId, videoId, m.source, m.translate);
    }
    case "translation-save":
      return saveTranslation(m.translation);
    case "subtitle-cancel":
      coordinator.cancel(tabId);
      return coordinator.get(tabId, videoId);
    case "subtitle-retry-search":
      return coordinator.retrySearch(tabId, videoId, m.route);
    case "subtitle-reset":
      coordinator.reset(tabId);
      await chrome.storage.local.remove("subtitle-v2:" + tabId);
      // Reloading a song means starting it over, including its local data.
      if (m.clearLocalData) await subtitleCache.deleteVideo(videoId);
      return ensure(tabId, videoId);
    case "settings-public":
      return getPublicSettings();
    case "settings-edit":
      return getSettings();
    case "settings-save":
      coordinator.resetAll();
      return saveSettings(m.provider, m.preferences);
    case "preferences-save":
      coordinator.resetAll();
      return savePreferences(m.preferences);
    case "clear-credentials":
      coordinator.resetAll();
      return clearCredentials();
    case "open-options":
      return chrome.runtime.openOptionsPage();
    case "inspect":
      return inspectVideo(tabId);
    case "models":
      return createAiClient(normalizeProvider(m.provider)).listModels(
        AbortSignal.timeout(8000),
      );
    case "connection-check": {
      const s = await getSettings();
      if (!s.provider?.model) return { reachable: false };
      try {
        await createAiClient(s.provider).listModels(AbortSignal.timeout(8000));
        return { reachable: true };
      } catch {
        return { reachable: false };
      }
    }
    case "results-list":
      return listResults(ownOptions ? m.videoId : videoId);
    case "results-delete":
      return deleteResult(m.key as never);
    case "results-clear":
      return clearResults();
    case "cache-list":
      return subtitleCache.list();
    case "cache-delete":
      return subtitleCache.deleteVideo(m.videoId);
    case "cache-clear":
      await clearCachedTranslations();
      return subtitleCache.clear();
    case "run": {
      const run = testRuns.get(m.runId);
      if (run && run.state.tabId !== tabId) throw Error("工作不屬於此分頁");
      return run ?? null;
    }
    case "cancel":
      return null;
    case "search-test": {
      const s = await getSettings();
      if (!s.provider?.model) throw Error("請先儲存 AI 服務設定");
      if (
        m.consent.purpose !== "search-test" ||
        m.consent.settingsRevision !== s.revision ||
        Date.now() - m.consent.confirmedAt > 600000 ||
        m.consent.confirmedAt > Date.now() + 5000 ||
        m.consent.inputHash !==
          (await hashInput({ purpose: "search-test", body: m.body }))
      )
        throw Error("請重新確認傳送內容");
      const runId = crypto.randomUUID(),
        now = Date.now();
      const record: RunRecord = {
        state: {
          schemaVersion: 1,
          runId,
          tabId,
          videoId: "00000000000",
          settingsRevision: s.revision,
          phase: "searching",
          startedAt: now,
          deadlineAt: now + 120000,
          requestCount: 1,
          completedLineIds: [],
        },
      };
      testRuns.set(runId, record);
      void searchTest(
        createAiClient(s.provider),
        m.body,
        s.preferences.commentsPrompt,
      ).then(
        (output) => {
          record.output = output;
          record.state.phase = "complete";
        },
        (error) => {
          record.state.phase = "failed";
          record.state.errorCode = String(error.message);
        },
      );
      return record.state;
    }
  }
}
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    void handleMessage(message, sender).then(
      (data) => reply({ ok: true, data }),
      (error) =>
        reply({
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
    coordinator.reset(id);
    void chrome.storage.local.remove("subtitle-v2:" + id);
  });
  chrome.tabs.onUpdated.addListener((id, change) => {
    if (change.url) coordinator.reset(id);
  });
}
