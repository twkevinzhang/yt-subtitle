import React from "react";
import type { LyricCandidate } from "../shared/types";
export function Candidates({
  candidates,
  onSelect,
}: {
  candidates: LyricCandidate[];
  onSelect: (candidate: LyricCandidate) => void;
}) {
  return (
    <section>
      <h3>選擇歌詞版本</h3>
      {!candidates.length && (
        <p>沒有符合來源限制的結果，請貼上歌詞或匯入檔案。</p>
      )}
      {candidates.map((c) => (
        <article key={c.id} className="candidate">
          <h3>
            {c.title} — {c.artist}
          </h3>
          <p>
            {c.version || "未標示版本"}／{c.language}
          </p>
          <p>{c.matchReason}</p>
          <p>
            <a href={c.url} target="_blank" rel="noopener noreferrer">
              開啟歌詞來源
            </a>
          </p>
          <small>
            {c.fullText ? "已取得全文" : "需要貼入全文"}；
            {c.syncedLyrics ? "有同步歌詞" : "無同步時間"}；搜尋證據
            {c.evidence.status === "verified" ? "已驗證" : "尚未驗證"}
          </small>
          <div className="row">
            <button onClick={() => onSelect(c)}>使用這個版本</button>
          </div>
        </article>
      ))}
    </section>
  );
}
