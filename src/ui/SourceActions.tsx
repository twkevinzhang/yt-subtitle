import React from "react";
export function SourceActions({
  busy,
  configured,
  hasManual,
  onAI,
  onYT,
  onPaste,
}: {
  busy: boolean;
  configured: boolean;
  hasManual: boolean;
  onAI: (event: React.MouseEvent) => void;
  onYT: () => void;
  onPaste: () => void;
}) {
  return (
    <div className="source-actions stack">
      <button className="primary" disabled={busy || !configured} onClick={onAI}>
        AI 找字幕
      </button>
      <small>使用 AI 額度，發送 3 路搜尋</small>
      <button
        className={hasManual ? "yt-manual" : ""}
        disabled={busy || !hasManual}
        onClick={onYT}
      >
        YT 字幕
      </button>
      {!hasManual && (
        <small>沒有可用人工字幕（自動產生／自動翻譯不可使用）</small>
      )}
      <button disabled={busy} onClick={onPaste}>
        貼入字幕
      </button>
    </div>
  );
}
