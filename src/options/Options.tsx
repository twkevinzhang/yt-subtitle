import React, { useEffect, useState } from "react";
import { request } from "../shared/messages";
import {
  normalizeProvider,
  normalizeSources,
  type SettingsRecord,
} from "../background/settings";
import { preferencesSchema, providerSchema } from "../shared/schemas";
import type {
  ProviderSettings,
  SourceSettings,
  Preferences,
  SavedResult,
  RunState,
  SearchTestResult,
} from "../shared/types";
import { hashInput } from "../background/results";
import type { RunRecord } from "../background/runs";
import { AiReply } from "../ui/AiReply";
const emptyProvider: ProviderSettings = {
  schemaVersion: 1,
  baseUrl: "",
  apiToken: "",
  model: "",
};
type SectionId = "ai" | "sources" | "preferences" | "records";
type Notice = { status?: string; error?: string };
const serviceKey = (p: ProviderSettings | null) =>
  p &&
  JSON.stringify([
    p.baseUrl,
    p.apiToken,
    p.cfClientId || "",
    p.cfClientSecret || "",
  ]);
export function Options() {
  const [provider, setProvider] = useState(emptyProvider),
    [savedProvider, setSavedProvider] = useState<ProviderSettings | null>(null),
    [sources, setSources] = useState<SourceSettings[]>([]),
    [preferences, setPreferences] = useState<Preferences>({
      mode: "original",
      targetLanguage: "zh-Hant",
      fontSize: 28,
      position: "bottom",
    }),
    [models, setModels] = useState<string[]>([]),
    [records, setRecords] = useState<SavedResult[]>([]),
    [testReply, setTestReply] = useState<string | null>(null),
    [feedback, setFeedback] = useState<Partial<Record<SectionId, Notice>>>({
      ai: { status: "正在載入…" },
    }),
    [busy, setBusy] = useState<SectionId | null>(null);
  const serviceChanged = serviceKey(provider) !== serviceKey(savedProvider);
  const savedModelReady =
    !serviceChanged &&
    !!savedProvider?.model &&
    savedProvider.model === provider.model;
  const modelChoices = [
    ...new Set([...models, ...(provider.model ? [provider.model] : [])]),
  ];
  const notify = (section: SectionId, notice: Notice) =>
    setFeedback((previous) => ({ ...previous, [section]: notice }));
  const sectionNotice = (section: SectionId) => (
    <>
      {feedback[section]?.error && (
        <p className="notice error" role="alert">
          {feedback[section]!.error}
        </p>
      )}
      {(busy === section || feedback[section]?.status) && (
        <p className="notice" role="status">
          {busy === section ? "正在處理…" : feedback[section]?.status}
        </p>
      )}
    </>
  );
  const attempt = async (section: SectionId, fn: () => Promise<void>) => {
    notify(section, {});
    setBusy(section);
    try {
      await fn();
    } catch (e) {
      notify(section, {
        error: e instanceof Error ? e.message : "操作失敗，請重試。",
      });
    } finally {
      setBusy(null);
    }
  };
  const load = async () => {
    const record = await request<SettingsRecord>({ type: "settings-edit" });
    setProvider(record.provider || emptyProvider);
    setSavedProvider(record.provider);
    setModels([]);
    setSources(record.sources);
    setPreferences(record.preferences);
    try {
      setRecords(await request<SavedResult[]>({ type: "results-list" }));
    } catch {
      notify("records", { error: "本機結果讀取失敗，請重新整理設定頁。" });
    }
    notify("ai", { status: "設定保存在這台電腦，不跨裝置同步。" });
  };
  useEffect(() => {
    void attempt("ai", load);
  }, []);
  const field = (
    key: "baseUrl" | "apiToken" | "cfClientId" | "cfClientSecret",
    label: string,
    password = false,
  ) => (
    <label>
      <span>{label}</span>
      <input
        type={password ? "password" : "text"}
        autoComplete="off"
        spellCheck={false}
        disabled={!!busy}
        value={String(provider[key] || "")}
        onChange={(e) => {
          setProvider({ ...provider, [key]: e.target.value, model: "" });
          setModels([]);
          setTestReply(null);
          notify("ai", { status: "服務資料已變更，請重新載入模型。" });
        }}
      />
    </label>
  );
  const updateSource = (id: string, patch: Partial<SourceSettings>) =>
    setSources(sources.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const currentProvider = () => {
    const parsed = providerSchema.safeParse(provider);
    if (!parsed.success)
      throw new Error(
        parsed.error.issues[0].path[0] === "apiToken"
          ? "請填入 API Token。"
          : "請填入有效的 AI 服務網址。",
      );
    return normalizeProvider(parsed.data);
  };
  const save = (section: SectionId = "ai") => {
    let normalized: ProviderSettings | undefined;
    let normalizedSources: SourceSettings[] | undefined;
    let valid = true;
    setFeedback((previous) => ({
      ...previous,
      ai: {},
      sources: {},
      preferences: {},
    }));
    try {
      normalized = currentProvider();
    } catch (e) {
      notify("ai", { error: (e as Error).message });
      valid = false;
    }
    try {
      normalizedSources = normalizeSources(sources);
    } catch {
      notify("sources", {
        error:
          "請檢查來源名稱與網域；來源請填網域，例如 example.com，不含網址路徑。",
      });
      valid = false;
    }
    if (!preferencesSchema.safeParse(preferences).success) {
      notify("preferences", {
        error: "請檢查字幕顯示欄位，字級必須介於 14–64 px。",
      });
      valid = false;
    }
    if (!valid || !normalized || !normalizedSources) return;
    const nextProvider = normalized,
      nextSources = normalizedSources;
    void attempt(section, async () => {
      const granted = await chrome.permissions.request({
        origins: [new URL(nextProvider.baseUrl).origin + "/*"],
      });
      if (!granted) {
        notify("ai", { error: "未授予 AI 服務連線權限。" });
        return;
      }
      await request({
        type: "settings-save",
        provider: nextProvider,
        sources: nextSources,
        preferences,
      });
      setProvider(nextProvider);
      setSavedProvider(nextProvider);
      setSources(nextSources);
      notify(section, {
        status: nextProvider.model
          ? "已儲存設定。搜尋能力需另外測試。"
          : "已儲存服務設定，請載入並選擇模型，再儲存以啟用 AI。",
      });
    });
  };
  const loadModels = () =>
    attempt("ai", async () => {
      const draft = currentProvider();
      const granted = await chrome.permissions.request({
        origins: [new URL(draft.baseUrl).origin + "/*"],
      });
      if (!granted) throw new Error("未授予 AI 服務連線權限。");
      const list = await request<string[]>({ type: "models", provider: draft });
      const choices = [
        ...new Set(
          list
            .filter((m) => typeof m === "string" && m.trim())
            .map((m) => m.trim()),
        ),
      ];
      setModels(choices);
      if (!choices.length)
        throw new Error(
          "連線成功，但服務沒有提供可選擇的模型，請確認服務設定後重試。",
        );
      if (provider.model && !choices.includes(provider.model)) {
        setProvider({ ...provider, model: "" });
        notify("ai", {
          status: "連線成功，原模型已不在清單中，請重新選擇並儲存。",
        });
      } else
        notify("ai", {
          status: `連線成功，取得 ${choices.length} 個模型。搜尋尚未驗證。`,
        });
    });
  const testSearch = () =>
    attempt("ai", async () => {
      if (
        !window.confirm(
          "會使用已儲存的 AI 設定與來源，發送一次搜尋測試並消耗模型額度。繼續？",
        )
      )
        return;
      setTestReply(null);
      const s = await request<SettingsRecord>({ type: "settings-edit" });
      const consent = {
        purpose: "search-test" as const,
        inputHash: await hashInput({ purpose: "search-test" }),
        settingsRevision: s.revision,
        confirmedAt: Date.now(),
      };
      const run = await request<RunState>({ type: "search-test", consent });
      try {
        const deadline = Date.now() + 130000;
        while (Date.now() < deadline) {
          const r = await request<RunRecord>({ type: "run", runId: run.runId });
          if (r.state.phase === "complete") {
            const output = r.output as Partial<SearchTestResult> | undefined;
            if (typeof output?.text !== "string")
              throw new Error("服務未提供可顯示的 AI 回覆，請重新測試。");
            setTestReply(output.text);
            notify("ai", {
              status: "測試完成；搜尋能力尚未驗證。",
            });
            return;
          }
          if (["failed", "cancelled", "interrupted"].includes(r.state.phase))
            throw new Error(r.state.errorCode || "測試中斷");
          await new Promise((r) => setTimeout(r, 1000));
        }
        throw new Error("測試逾時");
      } finally {
        await request({ type: "cancel", runId: run.runId });
      }
    });
  return (
    <main className="options">
      <header>
        <h1>AI 歌詞設定</h1>
        <p className="summary">
          讓歌曲保留原本的畫面，讓歌詞跟上聲音。填入你自己的 AI 服務，在 YouTube
          播放器按 AI 開始。
        </p>
      </header>
      <section aria-label="AI 服務">
        <h2>AI 服務</h2>
        <p>
          使用支援網頁搜尋的 OpenAI
          相容服務。填入服務資料即可載入模型，選擇後再儲存；僅能列出模型不代表支援搜尋。
        </p>
        <div className="grid">
          {field("baseUrl", "Base URL（通常包含 /v1）")}
          {field("apiToken", "API Token", true)}
        </div>
        <details>
          <summary>Cloudflare Access（選填，ID 與 Secret 成對）</summary>
          <div className="grid">
            {field("cfClientId", "Cloudflare Client ID")}
            {field("cfClientSecret", "Cloudflare Client Secret", true)}
          </div>
        </details>
        <div className="model-field">
          <p id="model-label">從目前服務載入的模型</p>
          <div className="row">
            {modelChoices.length > 0 && (
              <select
                aria-label="模型清單"
                aria-describedby="model-label"
                disabled={!!busy}
                value={provider.model}
                onChange={(e) => {
                  setProvider({ ...provider, model: e.target.value });
                  setTestReply(null);
                  notify("ai", { status: "模型選擇已變更，請儲存設定。" });
                }}
              >
                <option value="">選擇模型</option>
                {modelChoices.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
            <button disabled={!!busy} onClick={loadModels}>
              載入模型
            </button>
          </div>
        </div>
        <div className="row">
          <button
            disabled={!!busy}
            className="primary"
            onClick={() => save("ai")}
          >
            儲存設定
          </button>
          <button disabled={!!busy || !savedModelReady} onClick={testSearch}>
            測試搜尋（使用額度）
          </button>
        </div>
        {sectionNotice("ai")}
        {testReply !== null && <AiReply text={testReply} />}
      </section>
      <section aria-label="歌詞來源">
        <h2>歌詞來源</h2>
        <p>
          AI
          只能搜尋勾選的網域。首次使用請確認來源；未勾選任何來源時仍可貼上或匯入歌詞。
        </p>
        {sources.map((s) => (
          <div className="source" key={s.id}>
            <input
              disabled={!!busy}
              aria-label={`啟用 ${s.name}`}
              type="checkbox"
              checked={s.enabled}
              onChange={(e) =>
                updateSource(s.id, { enabled: e.target.checked })
              }
            />
            <input
              disabled={!!busy}
              aria-label="來源名稱"
              value={s.name}
              onChange={(e) => updateSource(s.id, { name: e.target.value })}
            />
            <input
              disabled={!!busy}
              aria-label="來源網域"
              placeholder="example.com"
              value={s.domain}
              onChange={(e) => updateSource(s.id, { domain: e.target.value })}
            />
            <button
              disabled={!!busy}
              onClick={() => setSources(sources.filter((x) => x.id !== s.id))}
            >
              移除
            </button>
            <label>
              <input
                disabled={!!busy}
                type="checkbox"
                checked={s.includeSubdomains}
                onChange={(e) =>
                  updateSource(s.id, { includeSubdomains: e.target.checked })
                }
              />
              也允許此網域的子網域
            </label>
          </div>
        ))}
        <button
          disabled={!!busy}
          onClick={() =>
            setSources([
              ...sources,
              {
                schemaVersion: 1,
                id: crypto.randomUUID(),
                name: "自訂來源",
                domain: "",
                includeSubdomains: false,
                enabled: true,
              },
            ])
          }
        >
          新增來源
        </button>
        {sectionNotice("sources")}
      </section>
      <section aria-label="字幕顯示">
        <h2>字幕顯示</h2>
        <div className="grid">
          <label>
            <span>預設模式</span>
            <select
              disabled={!!busy}
              value={preferences.mode}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  mode: e.target.value as Preferences["mode"],
                })
              }
            >
              <option value="original">原文</option>
              <option value="bilingual">原文＋譯文</option>
              <option value="translation">僅譯文</option>
            </select>
          </label>
          <label>
            <span>翻譯目標</span>
            <select
              disabled={!!busy}
              value={preferences.targetLanguage}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  targetLanguage: e.target
                    .value as Preferences["targetLanguage"],
                })
              }
            >
              <option value="zh-Hant">繁體中文</option>
              <option value="ja">日文</option>
              <option value="en">英文</option>
            </select>
          </label>
          <label>
            <span>字級（14–64 px）</span>
            <input
              disabled={!!busy}
              type="number"
              min="14"
              max="64"
              value={preferences.fontSize}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  fontSize: Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            <span>位置</span>
            <select
              disabled={!!busy}
              value={preferences.position}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  position: e.target.value as "top" | "bottom",
                })
              }
            >
              <option value="bottom">下方</option>
              <option value="top">上方</option>
            </select>
          </label>
        </div>
        <button disabled={!!busy} onClick={() => save("preferences")}>
          儲存全部設定
        </button>
        {sectionNotice("preferences")}
      </section>
      <section aria-label="本機結果">
        <h2>本機結果</h2>
        <p>
          已保存 {records.length} 份。重新載入已保存版本不會呼叫
          AI；容量不足時需自行刪除或匯出。
        </p>
        {records.map((r) => (
          <div className="row records" key={JSON.stringify(r.key)}>
            <span>
              {r.key.videoId}／{r.lines.length} 句／{r.key.targetLanguage}
            </span>
            <button
              disabled={!!busy}
              onClick={() =>
                attempt("records", async () => {
                  await request({ type: "results-delete", key: r.key });
                  await load();
                })
              }
            >
              刪除此版本
            </button>
          </div>
        ))}
        <div className="row">
          <button
            disabled={!!busy}
            onClick={() =>
              attempt("records", async () => {
                if (window.confirm("清除全部已保存歌詞？這個動作無法復原。")) {
                  await request({ type: "results-clear" });
                  await load();
                }
              })
            }
          >
            清除全部結果
          </button>
          <button
            disabled={!!busy}
            onClick={() =>
              attempt("records", async () => {
                if (window.confirm("移除這台電腦保存的 AI 憑證？")) {
                  await request({ type: "clear-credentials" });
                  await load();
                }
              })
            }
          >
            移除憑證
          </button>
        </div>
        <p className="muted credential-note">
          憑證保存在擴充功能本機儲存，不是加密保險箱；請使用可撤銷的獨立
          Token。第一版不處理音訊、不自動產生背景付費工作。
        </p>
        {sectionNotice("records")}
      </section>
    </main>
  );
}
