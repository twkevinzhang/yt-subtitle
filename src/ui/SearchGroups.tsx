import React from "react";
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
}: {
  snapshot?: SearchGroupSnapshot;
  onSelect: (candidate: LyricCandidate, route: SearchRoute) => void;
}) {
  return (
    <div className="stack">
      {(["configured", "comments", "web"] as const).map((route) => {
        const result = snapshot?.routes[route];
        return (
          <section className="section" key={route} aria-label={names[route]}>
            <h3>{names[route]}</h3>
            <p role="status">
              {!result || result.phase === "pending"
                ? "搜尋中…"
                : result.phase === "cancelled"
                  ? "已取消"
                  : (result.error ??
                    (result.candidates.length
                      ? `取得 ${result.candidates.length} 份候選`
                      : "沒有可用結果"))}
            </p>
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
                  disabled={!c.syncedLyrics && !c.fullText}
                  onClick={() => onSelect(c, route)}
                >
                  使用這個版本
                </button>
              </article>
            ))}
            {!!result?.text && (
              <details>
                <summary>AI 原始回覆</summary>
                <pre>{result.text}</pre>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}
