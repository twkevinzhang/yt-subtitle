import React, { useEffect } from "react";
import type { LyricCandidate } from "../shared/types";
import type {
  SearchGroupSnapshot,
  SearchRoute,
} from "../background/search-group";
import { lyricLines } from "../lyrics/preview";
import { candidateBrand, routeNames, usableCandidates } from "./SourceBadges";

export type Selected = { candidate: LyricCandidate; route: SearchRoute };

/** Shows what the AI answered: the lyrics it found, or its own words when it found none. */
export function AiResults({
  search,
  searching,
  selected,
  pending,
  onSelect,
  onUseSelected,
  onSearchAgain,
  onPaste,
}: {
  search?: SearchGroupSnapshot;
  searching: boolean;
  selected?: Selected;
  pending: boolean;
  onSelect(selected: Selected): void;
  onUseSelected?(): void;
  onSearchAgain?(): void;
  onPaste?(): void;
}) {
  const routes = (["lrclib", "comments", "web"] as const).map((route) => ({
    route,
    result: search?.routes[route],
    candidates: usableCandidates(search?.routes[route]?.candidates),
  }));
  // Candidates that already carry time codes go first; the rest keep source order.
  const options = routes
    .flatMap(({ route, candidates }) =>
      candidates.map((candidate) => ({
        key: route + ":" + candidate.id,
        route,
        candidate,
        lines: lyricLines(candidate.syncedLyrics ?? candidate.fullText),
      })),
    )
    .sort(
      (a, b) =>
        Number(!!b.candidate.syncedLyrics) - Number(!!a.candidate.syncedLyrics),
    );
  const found = options.length > 0;
  const best = options[0];
  const current = options.find(
    (o) =>
      selected?.route === o.route && selected.candidate.id === o.candidate.id,
  );
  // Most people take the first offer, so it starts selected and its preview shows at once.
  useEffect(() => {
    if (!current && best)
      onSelect({ candidate: best.candidate, route: best.route });
  }, [current, best?.key]);
  const failed = routes.filter(
    (r) => r.result && !r.candidates.length && r.result.phase !== "pending",
  );
  const waiting = routes.filter(
    (r) => r.result && !r.candidates.length && r.result.phase === "pending",
  );
  const said = failed.filter((r) => r.result?.error);
  const messages = said.map(({ route, result }) => (
    <div className="subtitle-ai-message" key={route}>
      <strong>{routeNames[route]}</strong>
      <p>{result!.error}</p>
    </div>
  ));
  const names = (list: typeof routes) =>
    list.map((r) => routeNames[r.route]).join("、");
  const note = [
    failed.length ? names(failed) + " 沒有可用歌詞" : "",
    waiting.length ? names(waiting) + " 搜尋中" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <h3 className="subtitle-section-title">AI搜尋結果</h3>
      {found && (
        <fieldset className="subtitle-candidates" disabled={pending}>
          <div className="subtitle-pick">
            <select
              aria-label="選擇字幕"
              value={current?.key ?? ""}
              onChange={(e) => {
                const pick = options.find((o) => o.key === e.target.value);
                if (pick)
                  onSelect({ candidate: pick.candidate, route: pick.route });
              }}
            >
              {!current && (
                <option value="" disabled>
                  請選擇一份字幕（共 {options.length} 份）
                </option>
              )}
              {options.map(({ key, route, candidate, lines }) => (
                <option key={key} value={key}>
                  {lines.length} 行 · {candidateBrand(candidate, route).name} ·{" "}
                  {candidate.title} · {candidate.language}
                </option>
              ))}
            </select>
            {onUseSelected && (
              <button
                className="primary"
                disabled={pending || !current}
                onClick={onUseSelected}
              >
                使用這份
              </button>
            )}
          </div>
          {current && (
            <small className="subtitle-reason">
              {current.candidate.matchReason}
              {current.candidate.matchReason ? " · " : ""}
              {current.candidate.syncedLyrics
                ? "沿用時間碼"
                : "無時間碼，使用後對齊整首"}
            </small>
          )}
        </fieldset>
      )}
      {found
        ? !!note && (
            <details className="subtitle-failures">
              <summary>{note}</summary>
              {messages}
            </details>
          )
        : messages}
      {current && (
        <details open>
          <summary>所選歌詞預覽</summary>
          <pre>
            {current.candidate.syncedLyrics ??
              current.candidate.fullText ??
              "此來源未提供歌詞內容"}
          </pre>
        </details>
      )}
      {!searching && (onPaste || onSearchAgain) && (
        <div className="subtitle-actions">
          {!onPaste ? null : found ? (
            <button className="link" disabled={pending} onClick={onPaste}>
              找不到我要的 → 貼入歌詞
            </button>
          ) : (
            <button className="primary" disabled={pending} onClick={onPaste}>
              貼入歌詞
            </button>
          )}
          {onSearchAgain && (
            <button disabled={pending} onClick={onSearchAgain}>
              重新搜尋
            </button>
          )}
        </div>
      )}
    </>
  );
}
