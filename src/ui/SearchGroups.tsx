import React, { useState, useId } from "react";
import { RequestEditor } from "./RequestEditor";
import type {
  SearchGroupSnapshot,
  SearchRoute,
} from "../background/search-group";
import type { LyricCandidate } from "../shared/types";
const names: Record<SearchRoute, string> = {
  configured: "設定的歌詞來源",
  comments: "YouTube 留言區",
  web: "全網搜尋",
};
export function SearchGroups({
  snapshot,
  onSelect,
  onRetry,
  onCancel,
}: {
  snapshot?: SearchGroupSnapshot;
  onRetry?: (
    route: SearchRoute,
    body: Record<string, unknown>,
  ) => void | Promise<void>;
  onCancel?: (route: SearchRoute) => void | Promise<void>;
  onSelect: (candidate: LyricCandidate, route: SearchRoute) => void;
}) {
  const [active, setActive] = useState<SearchRoute>("configured");
  const [pending, setPending] = useState<Partial<Record<SearchRoute, boolean>>>(
    {},
  );
  const [errors, setErrors] = useState<Partial<Record<SearchRoute, string>>>(
    {},
  );
  const prefix = useId();
  const routes = ["configured", "comments", "web"] as const;
  const retry = async (route: SearchRoute, body: Record<string, unknown>) => {
    setPending((p) => ({ ...p, [route]: true }));
    setErrors((p) => ({ ...p, [route]: "" }));
    try {
      await onRetry?.(route, body);
    } catch (e) {
      setErrors((p) => ({
        ...p,
        [route]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setPending((p) => ({ ...p, [route]: false }));
    }
  };
  return (
    <div className="search-workspace">
      <div className="search-tabs" role="tablist" aria-label="歌詞搜尋來源">
        {routes.map((route, index) => (
          <button
            key={route}
            role="tab"
            id={prefix + route + "-tab"}
            aria-controls={prefix + route}
            aria-selected={active === route}
            tabIndex={active === route ? 0 : -1}
            onClick={() => setActive(route)}
            onKeyDown={(e) => {
              let next = index;
              if (e.key === "ArrowRight") next = (index + 1) % 3;
              else if (e.key === "ArrowLeft") next = (index + 2) % 3;
              else if (e.key === "Home") next = 0;
              else if (e.key === "End") next = 2;
              else return;
              e.preventDefault();
              setActive(routes[next]);
              e.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                [next]?.focus();
            }}
          >
            {names[route]}
            <span className="tab-state" aria-hidden="true">
              {pending[route] || snapshot?.routes[route].phase === "pending"
                ? "搜尋中"
                : snapshot?.routes[route].candidates.length
                  ? snapshot.routes[route].candidates.length
                  : ""}
            </span>
          </button>
        ))}
      </div>
      {(["configured", "comments", "web"] as const).map((route) => {
        const result = snapshot?.routes[route];
        return (
          <section
            className="search-route"
            key={route}
            role="tabpanel"
            id={prefix + route}
            aria-labelledby={prefix + route + "-tab"}
            hidden={active !== route}
            tabIndex={0}
          >
            {route === "comments" && result?.commentsRead && (
              <p className="muted">
                已取得 {result.commentsRead.count} 則實際留言（置頂{" "}
                {result.commentsRead.pinned} 則）；僅分析已載入的前 20 則。
              </p>
            )}
            <p role="status">
              {pending[route] || !result || result.phase === "pending"
                ? "搜尋中…"
                : result.phase === "cancelled"
                  ? "已取消"
                  : (result.error ??
                    (result.candidates.length
                      ? `取得 ${result.candidates.length} 份候選`
                      : "沒有可用結果"))}
            </p>
            {pending[route] && (
              <p className="muted">
                重新請求中，以下保留上次結果；完成後會更新。
              </p>
            )}
            {result?.candidates.map((c) => (
              <article className="candidate" key={c.id}>
                <strong>
                  {c.title} — {c.artist}
                </strong>
                <p>
                  {c.language}／{c.version || "未標示版本"}
                </p>
                <a href={c.url} target="_blank" rel="noopener noreferrer">
                  開啟來源
                </a>
                {c.sourceId === "comments" && <p>{c.matchReason}</p>}
                <p>
                  {c.syncedLyrics ? "含時間碼" : "需要本機補時"}；搜尋證據
                  {c.evidence.status === "verified" ? "已驗證" : "尚未驗證"}
                </p>
                <details>
                  <summary>字幕預覽</summary>
                  <pre>
                    {(c.syncedLyrics || c.fullText || "尚無全文").slice(
                      0,
                      2000,
                    )}
                  </pre>
                </details>
                <button
                  disabled={
                    !!pending[route] ||
                    result.phase === "pending" ||
                    (!c.syncedLyrics && !c.fullText)
                  }
                  onClick={() => onSelect(c, route)}
                >
                  使用這個版本
                </button>
              </article>
            ))}
            {!!errors[route] && (
              <p role="alert" className="error">
                {errors[route]}
              </p>
            )}
            {result?.requestBody && (
              <RequestEditor
                body={result.requestBody}
                endpoint={result.endpoint}
                pending={!!pending[route] || result.phase === "pending"}
                onSend={(body) => void retry(route, body)}
                onCancel={() =>
                  void Promise.resolve(onCancel?.(route)).catch((e) =>
                    setErrors((p) => ({ ...p, [route]: String(e) })),
                  )
                }
              />
            )}
            {result?.requestBody && (
              <details>
                <summary>實際送出內容</summary>
                <pre>{JSON.stringify(result.requestBody, null, 2)}</pre>
              </details>
            )}
            {!!result?.text && (
              <details>
                <summary>AI 原始回覆</summary>
                <pre>{result.text}</pre>
              </details>
            )}
            {result?.rawResponse !== undefined && (
              <details>
                <summary>
                  API 原始回應
                  {result.httpStatus ? " · HTTP " + result.httpStatus : ""}
                </summary>
                <pre>
                  {typeof result.rawResponse === "string"
                    ? result.rawResponse
                    : JSON.stringify(result.rawResponse, null, 2)}
                </pre>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}
