import React from "react";

export function ContentSkeleton({ label }: { label: string }) {
  return (
    <div
      className="content-skeleton"
      role="status"
      aria-label={label}
      aria-busy="true"
    >
      <p className="muted">{label}…</p>
      <div aria-hidden="true" className="skeleton-lines">
        <span className="skeleton-bar skeleton-title" />
        <span className="skeleton-bar" />
        <span className="skeleton-bar" />
        <span className="skeleton-bar skeleton-short" />
        <span className="skeleton-bar skeleton-block" />
      </div>
    </div>
  );
}

export function PanelSkeleton({
  onClose,
  error,
  onRetry,
}: {
  onClose: () => void;
  error?: string;
  onRetry?: () => void;
}) {
  return (
    <section
      className="panel"
      role="region"
      aria-label="AI 歌詞工作面板"
      aria-busy={!error}
    >
      <header>
        <h2>AI 歌詞</h2>
        <button aria-label="關閉面板" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="workspace">
        <div className="operations panel-body skeleton-column">
          {error ? (
            <>
              <p className="notice error" role="alert">
                {error}
              </p>
              <button onClick={onRetry}>重試</button>
            </>
          ) : (
            <ContentSkeleton label="正在載入 AI 歌詞面板" />
          )}
        </div>
        <div className="lyrics-preview skeleton-column">
          {error ? (
            <p className="muted">讀取設定後即可準備歌詞預覽。</p>
          ) : (
            <ContentSkeleton label="正在準備歌詞預覽" />
          )}
        </div>
      </div>
    </section>
  );
}
