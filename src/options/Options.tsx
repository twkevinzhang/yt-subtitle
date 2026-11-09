import React, { useEffect, useState } from "react";
import { request } from "../shared/messages";
import { normalizeProvider, type SettingsRecord } from "../background/settings";
import { preferencesSchema, providerSchema } from "../shared/schemas";
import {
  DEFAULT_COMMENTS_INSTRUCTION,
  DEFAULT_WEB_INSTRUCTION,
} from "../lyrics/default-prompts";
import type { ProviderSettings, Preferences } from "../shared/types";
import { SearchTest } from "./SearchTest";
import { cacheDetails } from "./cache-format";
import type { CacheEntry } from "../subtitle/cache-store";
const emptyProvider: ProviderSettings = {
  schemaVersion: 1,
  baseUrl: "",
  apiToken: "",
  model: "",
};
type SectionId = "ai" | "preferences" | "cache";
type Notice = { status?: string; error?: string };
const serviceKey = (p: ProviderSettings | null) =>
  p &&
  JSON.stringify([
    p.baseUrl,
    p.apiToken,
    p.cfClientId || "",
    p.cfClientSecret || "",
  ]);
const categories = [
  ["ai", "AI 服務"],
  ["preferences", "字幕與搜尋"],
  ["cache", "本機資料"],
] as const;
export function Options() {
  const [active, setActive] = useState<SectionId>("ai");
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [provider, setProvider] = useState(emptyProvider),
    [savedProvider, setSavedProvider] = useState<ProviderSettings | null>(null),
    [preferences, setPreferences] = useState<Preferences>({
      autoSearchApproved: false,
      mode: "original",
      targetLanguage: "zh-Hant",
      fontSize: 28,
      position: "bottom",
    }),
    [models, setModels] = useState<string[]>([]),
    [cacheEntries, setCacheEntries] = useState<CacheEntry[]>([]),
    [testOpen, setTestOpen] = useState(false),
    [feedback, setFeedback] = useState<Partial<Record<SectionId, Notice>>>({
      ai: { status: "正在載入…" },
    }),
    [busy, setBusy] = useState<SectionId | null>(null);
  const dirty =
    snapshot !== null && snapshot !== JSON.stringify([provider, preferences]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
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
    setPreferences(record.preferences);
    setSnapshot(
      JSON.stringify([record.provider || emptyProvider, record.preferences]),
    );
    try {
      setCacheEntries(await request<CacheEntry[]>({ type: "cache-list" }));
    } catch {
      notify("cache", { error: "本機資料讀取失敗，請重新整理設定頁。" });
    }
    notify("ai", {});
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
          notify("ai", { status: "服務資料已變更，請重新載入模型。" });
        }}
      />
    </label>
  );
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
    let valid = true;
    let firstError: SectionId | null = null;
    setSaveMessage("");
    setFeedback((previous) => ({
      ...previous,
      ai: {},
      preferences: {},
    }));
    try {
      normalized = currentProvider();
    } catch (e) {
      notify("ai", { error: (e as Error).message });
      valid = false;
      firstError ??= "ai";
    }
    if (!preferencesSchema.safeParse(preferences).success) {
      notify("preferences", {
        error: "請檢查字幕顯示欄位，字級必須介於 14–64 px。",
      });
      valid = false;
    }
    if (!valid || !normalized) {
      setActive(firstError || "preferences");
      setSaveMessage("無法儲存，請修正標示的欄位。");
      return;
    }
    const nextProvider = normalized;
    void attempt(section, async () => {
      const granted = await chrome.permissions.request({
        origins: [new URL(nextProvider.baseUrl).origin + "/*"],
      });
      if (!granted) {
        setActive("ai");
        setSaveMessage("未授予連線權限，設定尚未儲存。");
        notify("ai", { error: "未授予 AI 服務連線權限。" });
        return;
      }
      await request({
        type: "settings-save",
        provider: nextProvider,
        preferences,
      });
      setProvider(nextProvider);
      setSavedProvider(nextProvider);
      setSnapshot(JSON.stringify([nextProvider, preferences]));
      setSaveMessage("所有設定已儲存");
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
  return (
    <main className="options">
      <header className="options-header">
        <h1>AI 歌詞設定</h1>
        <p className="summary">
          設定搜尋歌詞的 AI 服務，調整 YouTube 字幕的顯示方式。
        </p>
        <span className={`service-status ${savedModelReady ? "ready" : ""}`}>
          AI 狀態：{savedModelReady ? "已儲存模型，搜尋待測試" : "尚未完成設定"}
        </span>
      </header>
      <div className="options-workspace">
        <nav className="options-nav" aria-label="設定分類">
          {categories.map(([id, label]) => (
            <button
              key={id}
              aria-current={active === id ? "page" : undefined}
              onClick={() => setActive(id)}
            >
              {label}
              {feedback[id]?.error && <span className="nav-error">需處理</span>}
            </button>
          ))}
          <p>設定與歌詞保存在這台電腦，不跨裝置同步。</p>
        </nav>
        <div className="options-content">
          <section hidden={active !== "ai"} aria-label="AI 服務">
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
            <h3>選擇搜尋模型</h3>
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
            <h3>驗證搜尋能力</h3>
            <div className="row">
              <button
                disabled={!savedModelReady || !!busy}
                aria-expanded={testOpen}
                aria-controls="search-test"
                onClick={() => setTestOpen(!testOpen)}
              >
                測試搜尋（使用額度）
                <span aria-hidden="true">{testOpen ? " ▴" : " ▾"}</span>
              </button>
            </div>
            <p className="muted">
              {savedModelReady
                ? "已儲存的模型可以進行搜尋測試；連線成功不代表搜尋可用。"
                : "填入服務資料並載入模型，選擇模型後按下方「儲存所有設定」，即可測試搜尋。"}
            </p>
            {sectionNotice("ai")}
            <details className="credential-settings">
              <summary>憑證管理</summary>
              <p>
                憑證保存在擴充功能本機儲存，請使用可撤銷的獨立
                Token。移除後需重新設定 AI 服務。
              </p>
              <button
                disabled={!!busy}
                onClick={() =>
                  attempt("ai", async () => {
                    if (window.confirm("移除這台電腦保存的 AI 憑證？")) {
                      await request({ type: "clear-credentials" });
                      const record = await request<SettingsRecord>({
                        type: "settings-edit",
                      });
                      setProvider(record.provider || emptyProvider);
                      setSavedProvider(record.provider);
                      setModels([]);
                      setSnapshot(
                        JSON.stringify([
                          record.provider || emptyProvider,
                          JSON.parse(snapshot!)[1],
                          JSON.parse(snapshot!)[2],
                        ]),
                      );
                      setSaveMessage("憑證已移除，請重新設定 AI 服務。");
                    }
                  })
                }
              >
                移除憑證
              </button>
            </details>
            <SearchTest
              key={`${serviceKey(provider)}:${provider.model}`}
              open={testOpen}
              ready={savedModelReady}
              model={provider.model}
              webPrompt={preferences.webPrompt}
              onBusy={(value) => setBusy(value ? "ai" : null)}
            />
          </section>
          <section hidden={active !== "preferences"} aria-label="字幕顯示">
            <h2>字幕與搜尋</h2>
            <p>預覽字級與位置，再決定何時啟動字幕搜尋。</p>
            <div
              className={`subtitle-sample ${preferences.position}`}
              aria-label="字幕顯示預覽"
            >
              <span className="preview-caption">字幕預覽</span>
              <span
                className="sample-line"
                style={{ fontSize: `${preferences.fontSize}px` }}
              >
                讓歌詞跟上聲音
              </span>
            </div>
            <div className="grid">
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
            <h3>自動搜尋</h3>
            <label className="auto-search-consent">
              <input
                type="checkbox"
                disabled={!!busy}
                checked={preferences.autoSearchApproved ?? false}
                onChange={(event) =>
                  setPreferences({
                    ...preferences,
                    autoSearchApproved: event.target.checked,
                  })
                }
              />
              允許影片載入時自動搜尋字幕（傳送影片資訊與留言到已設定 AI
              服務，會使用模型額度）
            </label>
            <h3>搜尋指示</h3>
            {(
              [
                ["webPrompt", "Google 搜尋", DEFAULT_WEB_INSTRUCTION],
                ["commentsPrompt", "留言區", DEFAULT_COMMENTS_INSTRUCTION],
              ] as const
            ).map(([key, label, fallback]) => (
              <div className="prompt-field" key={key}>
                <label>
                  <span>{label}</span>
                  <textarea
                    rows={8}
                    disabled={!!busy}
                    maxLength={4000}
                    value={preferences[key] ?? fallback}
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        [key]: event.target.value,
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  disabled={!!busy || preferences[key] === undefined}
                  onClick={() =>
                    setPreferences({ ...preferences, [key]: undefined })
                  }
                >
                  還原預設
                </button>
              </div>
            ))}
            {sectionNotice("preferences")}
          </section>
          <section hidden={active !== "cache"} aria-label="本機資料">
            <h2>本機資料（{cacheEntries.length}）</h2>
            {cacheEntries.map((entry) => (
              <div className="row records" key={entry.videoId}>
                <span>
                  {entry.title || entry.videoId}
                  <small className="cache-details">
                    {cacheDetails(entry).join(" · ")}
                  </small>
                </span>
                <button
                  aria-label={`刪除 ${entry.title || entry.videoId}`}
                  disabled={!!busy}
                  onClick={() =>
                    attempt("cache", async () => {
                      await request({
                        type: "cache-delete",
                        videoId: entry.videoId,
                      });
                      setCacheEntries(
                        await request<CacheEntry[]>({ type: "cache-list" }),
                      );
                    })
                  }
                >
                  刪除
                </button>
              </div>
            ))}
            <div className="row">
              <button
                disabled={!!busy || !cacheEntries.length}
                onClick={() =>
                  attempt("cache", async () => {
                    if (
                      window.confirm("清除全部本機資料？這個動作無法復原。")
                    ) {
                      await request({ type: "cache-clear" });
                      setCacheEntries(
                        await request<CacheEntry[]>({ type: "cache-list" }),
                      );
                    }
                  })
                }
              >
                清除全部本機資料
              </button>
            </div>
            {sectionNotice("cache")}
          </section>
        </div>
      </div>
      <footer className="options-savebar">
        <div role="status">
          <strong>
            {busy
              ? "正在處理…"
              : dirty
                ? "有尚未儲存的變更"
                : saveMessage || "設定已載入"}
          </strong>
          <span>一次儲存 AI 服務與字幕設定</span>
          {dirty && saveMessage && saveMessage !== "所有設定已儲存" && (
            <p>{saveMessage}</p>
          )}
          {feedback.preferences?.error && (
            <p className="error">{feedback.preferences.error}</p>
          )}
        </div>
        <button
          disabled={!!busy || !dirty || snapshot === null}
          className="primary"
          onClick={() => save("preferences")}
        >
          儲存所有設定
        </button>
      </footer>
    </main>
  );
}
