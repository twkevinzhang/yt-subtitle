import React, { useState, useRef } from "react";

export function RequestEditor({
  body,
  endpoint,
  pending,
  onSend,
  onCancel,
}: {
  body: Record<string, unknown>;
  endpoint?: string;
  pending: boolean;
  onSend: (body: Record<string, unknown>) => void;
  onCancel?: () => void;
}) {
  const original = useRef(JSON.stringify(body, null, 2)).current;
  const [draft, setDraft] = useState(original),
    [mode, setMode] = useState<"form" | "json">("form"),
    [feedback, setFeedback] = useState("");
  const highlight = useRef<HTMLPreElement>(null),
    gutter = useRef<HTMLDivElement>(null);
  let parsed: Record<string, unknown> | undefined,
    error = "";
  try {
    const value = JSON.parse(draft);
    if (!value || Array.isArray(value) || typeof value !== "object")
      throw Error("最外層必須是 JSON 物件");
    parsed = value;
  } catch (e) {
    error = "JSON 格式錯誤：" + (e instanceof Error ? e.message : String(e));
  }
  if (parsed?.stream === true)
    error = "請將 stream 設為 false，目前不支援串流回覆。";
  const update = (key: string, value: unknown) => {
    if (parsed) setDraft(JSON.stringify({ ...parsed, [key]: value }, null, 2));
  };
  const messagesKey = Array.isArray(parsed?.messages) ? "messages" : "input";
  const messages = parsed?.[messagesKey];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setFeedback("已複製請求");
    } catch {
      setFeedback("無法存取剪貼簿，請選取 JSON 後複製");
    }
  };
  const tokens = draft.split(
    /("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?\b)/g,
  );
  return (
    <details className="request-editor">
      <summary>請求內容</summary>
      <p className="muted request-endpoint">
        POST /{endpoint ?? "responses"} · 驗證憑證沿用設定
      </p>
      <div className="row editor-switch" aria-label="請求編輯方式">
        <button
          type="button"
          aria-pressed={mode === "form"}
          onClick={() => setMode("form")}
        >
          輔助編輯
        </button>
        <button
          type="button"
          aria-pressed={mode === "json"}
          onClick={() => setMode("json")}
        >
          完整 JSON
        </button>
      </div>
      {mode === "form" && (
        <div className="request-form">
          {!parsed ? (
            <p>請切換完整 JSON 修正格式，原有內容已保留。</p>
          ) : (
            <>
              <label>
                模型
                <input
                  value={typeof parsed.model === "string" ? parsed.model : ""}
                  onChange={(e) => update("model", e.target.value)}
                />
              </label>
              {typeof messages === "string" ? (
                <label>
                  提示內容
                  <textarea
                    value={messages}
                    onChange={(e) => update(messagesKey, e.target.value)}
                  />
                </label>
              ) : Array.isArray(messages) ? (
                messages.map((message, index) => {
                  if (!message || typeof message !== "object")
                    return (
                      <p key={index} className="muted">
                        第 {index + 1} 則訊息請在完整 JSON 編輯。
                      </p>
                    );
                  return (
                    <div key={index} className="request-message">
                      <label>
                        訊息 {index + 1} · 角色
                        <input
                          value={
                            typeof message.role === "string" ? message.role : ""
                          }
                          onChange={(e) =>
                            update(
                              messagesKey,
                              messages.map((m, i) =>
                                i === index
                                  ? { ...m, role: e.target.value }
                                  : m,
                              ),
                            )
                          }
                        />
                      </label>
                      {typeof message.content === "string" ? (
                        <label>
                          內容
                          <textarea
                            value={message.content}
                            onChange={(e) =>
                              update(
                                messagesKey,
                                messages.map((m, i) =>
                                  i === index
                                    ? { ...m, content: e.target.value }
                                    : m,
                                ),
                              )
                            }
                          />
                        </label>
                      ) : (
                        <p className="muted">
                          此訊息包含結構化內容，請在完整 JSON 編輯。
                        </p>
                      )}
                    </div>
                  );
                })
              ) : (
                <p className="muted">請在完整 JSON 編輯輸入內容。</p>
              )}
              <p className="muted">
                搜尋工具及其他參數可在完整 JSON
                修改；切換編輯方式會保留所有欄位。
              </p>
            </>
          )}
        </div>
      )}
      {mode === "json" && (
        <>
          <div className="row json-tools">
            <button
              disabled={!parsed}
              onClick={() =>
                parsed && setDraft(JSON.stringify(parsed, null, 2))
              }
            >
              格式化
            </button>
            <button onClick={() => void copy()}>複製 JSON</button>
            <small className="muted">{draft.split("\n").length} 行</small>
          </div>
          <div className="json-code">
            <div ref={gutter} aria-hidden="true" className="json-lines">
              {draft.split("\n").map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <pre ref={highlight} aria-hidden="true" className="json-highlight">
              {tokens.map((token, i) => (
                <span
                  key={i}
                  className={
                    /^".*:\s*$/.test(token)
                      ? "json-key"
                      : /^"/.test(token)
                        ? "json-string"
                        : /^(true|false|null|[-\d])/.test(token)
                          ? "json-value"
                          : ""
                  }
                >
                  {token}
                </span>
              ))}
              {"\n"}
            </pre>
            <textarea
              aria-label="完整 API JSON"
              aria-invalid={!!error}
              spellCheck={false}
              wrap="off"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onScroll={(e) => {
                if (highlight.current) {
                  highlight.current.scrollTop = e.currentTarget.scrollTop;
                  highlight.current.scrollLeft = e.currentTarget.scrollLeft;
                }
                if (gutter.current)
                  gutter.current.scrollTop = e.currentTarget.scrollTop;
              }}
            />
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!!feedback && (
        <p role="status" className="muted">
          {feedback}
        </p>
      )}
      <div className="row request-actions">
        <button
          disabled={draft === original || pending}
          onClick={() => {
            setDraft(original);
            setFeedback("已還原原始請求");
          }}
        >
          還原原始請求
        </button>
        {pending ? (
          <button onClick={onCancel}>取消此來源請求</button>
        ) : (
          <button
            className="primary"
            disabled={!!error || !parsed}
            onClick={() => parsed && onSend(parsed)}
          >
            重新發送此來源
          </button>
        )}
      </div>
      <p className="muted">重新發送會再次呼叫 AI 服務，依服務方案計費。</p>
    </details>
  );
}
