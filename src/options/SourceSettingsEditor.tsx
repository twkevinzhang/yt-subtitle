import React, { useEffect, useRef, useState } from "react";
import type { SourceSettings } from "../shared/types";
import {
  identifyWebsite,
  normalizeWebsite,
  type WebsitePreview,
} from "./site-metadata";

function WebsiteLogo({ icon, name }: { icon?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [icon]);
  return (
    <span className="website-logo">
      {icon && !failed ? (
        <img
          src={icon}
          alt={`${name} 的網站圖示`}
          onError={() => setFailed(true)}
        />
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          role="img"
          aria-label="預設網站圖示"
        >
          <circle cx="12" cy="12" r="9" />
          <ellipse cx="12" cy="12" rx="4" ry="9" />
          <path d="M3 12h18M5 6.5h14M5 17.5h14" />
        </svg>
      )}
    </span>
  );
}

export function SourceSettingsEditor({
  sources,
  onChange,
  disabled,
}: {
  sources: SourceSettings[];
  onChange: (sources: SourceSettings[]) => void;
  disabled: boolean;
}) {
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<WebsitePreview | null>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const job = useRef<AbortController | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latestSources = useRef(sources);
  latestSources.current = sources;
  const resetRequest = () => {
    clearTimeout(debounce.current);
    job.current?.abort();
    job.current = null;
    setPending(false);
  };
  useEffect(
    () => () => {
      clearTimeout(debounce.current);
      job.current?.abort();
    },
    [],
  );
  const duplicate = (domain: string) =>
    latestSources.current.some(
      (source) => source.domain.toLowerCase().replace(/^www\./, "") === domain,
    );
  const update = (id: string, patch: Partial<SourceSettings>) =>
    onChange(
      latestSources.current.map((source) =>
        source.id === id ? { ...source, ...patch } : source,
      ),
    );

  const identify = async (value: string, auto = false) => {
    resetRequest();
    setPreview(null);
    setError("");
    setNotice("");
    let domain: string;
    try {
      domain = normalizeWebsite(value).domain;
      if (duplicate(domain)) throw new Error("這個網域已在來源列表中。");
    } catch (e) {
      if (!auto)
        setError(e instanceof Error ? e.message : "請輸入有效的網站網址。");
      return;
    }
    const controller = new AbortController();
    job.current = controller;
    setPending(true);
    setNotice(`正在辨識 ${domain}…`);
    try {
      const result = await identifyWebsite(value, controller.signal, auto);
      if (job.current !== controller || controller.signal.aborted) return;
      setPreview(result);
      setName(result.name);
      setNotice(result.notice);
    } catch (e) {
      if (job.current === controller && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : "網站辨識失敗，請重試。");
    } finally {
      if (job.current === controller) {
        setPending(false);
        job.current = null;
      }
    }
  };
  const add = () => {
    if (!preview || disabled || pending) return;
    if (!name.trim()) {
      setError("請填入顯示名稱。");
      return;
    }
    if (duplicate(preview.domain)) {
      setError("這個網域已在來源列表中。");
      return;
    }
    if (sources.length >= 30) {
      setError("最多可加入 30 個來源，請先移除不需要的網站。");
      return;
    }
    onChange([
      ...sources,
      {
        schemaVersion: 1,
        id: crypto.randomUUID(),
        name: name.trim(),
        domain: preview.domain,
        iconDataUrl: preview.iconDataUrl,
        enabled: true,
        includeSubdomains: false,
      },
    ]);
    setPreview(null);
    setInput("");
    setError("");
    setNotice("已加入來源，按「儲存所有設定」後生效。");
  };
  const finishEdit = (id: string) => {
    if (!editName.trim()) {
      setError("請填入顯示名稱。");
      return;
    }
    update(id, { name: editName.trim() });
    setEditing(null);
    setError("");
  };
  const refreshIcon = async (source: SourceSettings) => {
    resetRequest();
    setError("");
    setPreview(null);
    const controller = new AbortController();
    job.current = controller;
    setPending(true);
    setNotice(`正在更新 ${source.name} 的圖示…`);
    try {
      const result = await identifyWebsite(source.domain, controller.signal);
      if (job.current !== controller || controller.signal.aborted) return;
      if (result.iconDataUrl)
        update(source.id, { iconDataUrl: result.iconDataUrl });
      setNotice(
        result.iconDataUrl
          ? "網站圖示已更新，請儲存所有設定；原有名稱保持不變。"
          : result.notice,
      );
    } catch {
      if (!controller.signal.aborted) setError("無法更新網站圖示，請重試。");
    } finally {
      if (job.current === controller) {
        setPending(false);
        job.current = null;
      }
    }
  };
  return (
    <div className="source-editor">
      <section className="source-entry" aria-label="新增網站">
        <h3>新增網站</h3>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void identify(input);
          }}
        >
          <label htmlFor="source-url">網站網址或網域</label>
          <div className="website-entry-row">
            <input
              id="source-url"
              type="text"
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              placeholder="貼上 https://lrclib.net/ 或輸入 lrclib.net"
              value={input}
              onPaste={(event) => {
                const text = event.clipboardData.getData("text");
                if (!text.trim()) return;
                event.preventDefault();
                setInput(text);
                void identify(text);
              }}
              onChange={(event) => {
                const value = event.target.value;
                resetRequest();
                setInput(value);
                setPreview(null);
                setNotice("");
                setError("");
                debounce.current = setTimeout(
                  () => void identify(value, true),
                  650,
                );
              }}
            />
            <button type="submit" disabled={disabled || !input.trim()}>
              {pending ? "重新辨識" : "辨識網站"}
            </button>
          </div>
        </form>
        <p className="hint">
          貼上後自動辨識；也可按 Enter
          或「辨識網站」。僅讀取網站首頁，網址中的路徑會移除。
        </p>
        <p role="status" className="website-feedback">
          {notice}
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {preview && (
          <div className="website-preview">
            <h3>確認網站資訊</h3>
            <div className="website-identity">
              <WebsiteLogo icon={preview.iconDataUrl} name={name} />
              <div>
                <strong>{preview.name}</strong>
                <span className="website-domain">{preview.domain}</span>
              </div>
            </div>
            <label htmlFor="source-name">顯示名稱</label>
            <input
              id="source-name"
              type="text"
              value={name}
              maxLength={100}
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
            />
            <div className="website-preview-actions">
              <button
                disabled={disabled}
                onClick={() => {
                  resetRequest();
                  setPreview(null);
                  setNotice("");
                  setError("");
                }}
              >
                取消
              </button>
              <button
                className="primary"
                disabled={
                  disabled || pending || !name.trim() || sources.length >= 30
                }
                onClick={add}
              >
                新增來源
              </button>
            </div>
          </div>
        )}
      </section>
      <section className="source-list" aria-label="已加入的來源">
        <h3>
          已加入的來源 <span>{sources.length} / 30</span>
        </h3>
        <p className="hint">新增、修改與移除後，請儲存所有設定。</p>
        {!sources.length && (
          <p className="empty-records">還沒有來源，貼上網站網址即可新增。</p>
        )}
        {sources.map((source) => (
          <div className="website-source-row" key={source.id}>
            <WebsiteLogo icon={source.iconDataUrl} name={source.name} />
            <div className="website-source-info">
              {editing === source.id ? (
                <div className="website-name-editor">
                  <label htmlFor={`name-${source.id}`}>來源顯示名稱</label>
                  <input
                    id={`name-${source.id}`}
                    autoFocus
                    type="text"
                    maxLength={100}
                    disabled={disabled}
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") finishEdit(source.id);
                      if (event.key === "Escape") setEditing(null);
                    }}
                  />
                  <button
                    disabled={disabled || !editName.trim()}
                    onClick={() => finishEdit(source.id)}
                  >
                    完成修改
                  </button>
                  <button disabled={disabled} onClick={() => setEditing(null)}>
                    取消修改
                  </button>
                </div>
              ) : (
                <>
                  <strong>{source.name}</strong>
                  <span className="website-domain">{source.domain}</span>
                </>
              )}
            </div>
            <label className="website-enabled">
              <input
                type="checkbox"
                disabled={disabled}
                checked={source.enabled}
                onChange={(event) =>
                  update(source.id, { enabled: event.target.checked })
                }
                aria-label={`啟用 ${source.name}`}
              />
              啟用
            </label>
            <div className="website-row-actions">
              <button
                disabled={disabled}
                aria-label={`修改 ${source.name} 的名稱`}
                onClick={() => {
                  setEditing(source.id);
                  setEditName(source.name);
                }}
              >
                修改名稱
              </button>
              <button
                disabled={disabled || pending}
                onClick={() => void refreshIcon(source)}
              >
                更新圖示
              </button>
              <button
                disabled={disabled}
                aria-label={`移除 ${source.name}`}
                onClick={() =>
                  onChange(sources.filter((item) => item.id !== source.id))
                }
              >
                移除
              </button>
            </div>
            <label className="website-subdomains">
              <input
                type="checkbox"
                disabled={disabled}
                checked={source.includeSubdomains}
                onChange={(event) =>
                  update(source.id, { includeSubdomains: event.target.checked })
                }
              />
              包含子網域
            </label>
          </div>
        ))}
      </section>
    </div>
  );
}
