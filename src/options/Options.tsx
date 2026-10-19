import React, { useEffect, useState } from "react";
import { request } from "../shared/messages";
import type { SettingsRecord } from "../background/settings";
import type {
  ProviderSettings,
  SourceSettings,
  Preferences,
  SavedResult,
  RunState,
} from "../shared/types";
import { hashInput } from "../background/results";
import type { RunRecord } from "../background/runs";
const emptyProvider: ProviderSettings = {
  schemaVersion: 1,
  baseUrl: "",
  apiToken: "",
  model: "",
};
export function Options() {
  const [provider, setProvider] = useState(emptyProvider),
    [sources, setSources] = useState<SourceSettings[]>([]),
    [preferences, setPreferences] = useState<Preferences>({
      mode: "original",
      targetLanguage: "zh-Hant",
      fontSize: 28,
      position: "bottom",
    }),
    [models, setModels] = useState<string[]>([]),
    [records, setRecords] = useState<SavedResult[]>([]),
    [status, setStatus] = useState("正在載入…"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const attempt = async (fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const load = async () => {
    const record = await request<SettingsRecord>({ type: "settings-edit" });
    setProvider(record.provider || emptyProvider);
    setSources(record.sources);
    setPreferences(record.preferences);
    setRecords(await request<SavedResult[]>({ type: "results-list" }));
    setStatus("設定保存在這台電腦，不跨裝置同步。");
  };
  useEffect(() => {
    void attempt(load);
  }, []);
  const field = (
    key: keyof ProviderSettings,
    label: string,
    password = false,
  ) => (
    <label>
      <span>{label}</span>
      <input
        type={password ? "password" : "text"}
        autoComplete="off"
        spellCheck={false}
        value={String(provider[key] || "")}
        onChange={(e) => setProvider({ ...provider, [key]: e.target.value })}
      />
    </label>
  );
  const updateSource = (id: string, patch: Partial<SourceSettings>) =>
    setSources(sources.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const save = () =>
    attempt(async () => {
      const u = new URL(provider.baseUrl);
      if (!(
        u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(u.hostname))
      ))
        throw new Error("請使用 HTTPS 服務網址");
      const granted = await chrome.permissions.request({
        origins: [u.origin + "/*"],
      });
      if (!granted) throw new Error("未授予 AI 服務連線權限");
      await request({ type: "settings-save", provider, sources, preferences });
      setStatus("已儲存設定。搜尋能力需另外測試。");
    });
  const testSearch = () =>
    attempt(async () => {
      if (
        !window.confirm(
          "會使用已儲存的 AI 設定與來源，發送一次搜尋測試並消耗模型額度。繼續？",
        )
      )
        return;
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
            setStatus(
              "服務已回覆。通用文字介面無法核實搜尋工具證據，搜尋能力仍標示尚未驗證。",
            );
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
      <section>
        <h2>AI 服務</h2>
        <p>
          使用支援網頁搜尋的 OpenAI
          相容服務。先儲存，再測試連線；僅能列出模型不代表支援搜尋。
        </p>
        <div className="grid">
          {field("baseUrl", "Base URL（通常包含 /v1）")}
          {field("apiToken", "API Token", true)}
          {field("model", "模型名稱")}
          <label>
            <span>從已儲存服務載入的模型</span>
            <select
              aria-label="模型清單"
              value=""
              onChange={(e) =>
                setProvider({ ...provider, model: e.target.value })
              }
            >
              <option value="">選擇模型</option>
              {models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
        </div>
        <details>
          <summary>Cloudflare Access（選填，ID 與 Secret 成對）</summary>
          <div className="grid">
            {field("cfClientId", "Cloudflare Client ID")}
            {field("cfClientSecret", "Cloudflare Client Secret", true)}
          </div>
        </details>
        <div className="row">
          <button disabled={busy} className="primary" onClick={save}>
            儲存設定
          </button>
          <button
            disabled={busy}
            onClick={() =>
              attempt(async () => {
                const list = await request<string[]>({ type: "models" });
                setModels(list);
                setStatus(
                  `連線成功，取得 ${list.length} 個模型。搜尋尚未驗證。`,
                );
              })
            }
          >
            測試連線／載入模型
          </button>
          <button disabled={busy} onClick={testSearch}>
            測試搜尋（使用額度）
          </button>
        </div>
      </section>
      <section>
        <h2>歌詞來源</h2>
        <p>
          AI
          只能搜尋勾選的網域。首次使用請確認來源；未勾選任何來源時仍可貼上或匯入歌詞。
        </p>
        {sources.map((s) => (
          <div className="source" key={s.id}>
            <input
              aria-label={`啟用 ${s.name}`}
              type="checkbox"
              checked={s.enabled}
              onChange={(e) =>
                updateSource(s.id, { enabled: e.target.checked })
              }
            />
            <input
              aria-label="來源名稱"
              value={s.name}
              onChange={(e) => updateSource(s.id, { name: e.target.value })}
            />
            <input
              aria-label="來源網域"
              placeholder="example.com"
              value={s.domain}
              onChange={(e) => updateSource(s.id, { domain: e.target.value })}
            />
            <button
              onClick={() => setSources(sources.filter((x) => x.id !== s.id))}
            >
              移除
            </button>
            <label>
              <input
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
      </section>
      <section>
        <h2>字幕顯示</h2>
        <div className="grid">
          <label>
            <span>預設模式</span>
            <select
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
        <button disabled={busy} onClick={save}>
          儲存全部設定
        </button>
      </section>
      <section>
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
              disabled={busy}
              onClick={() =>
                attempt(async () => {
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
            disabled={busy}
            onClick={() =>
              attempt(async () => {
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
            disabled={busy}
            onClick={() =>
              attempt(async () => {
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
        <p className="muted">
          憑證保存在擴充功能本機儲存，不是加密保險箱；請使用可撤銷的獨立
          Token。第一版不處理音訊、不自動產生背景付費工作。
        </p>
      </section>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <p className="notice" role="status">
        {busy ? "正在處理…" : status}
      </p>
    </main>
  );
}
