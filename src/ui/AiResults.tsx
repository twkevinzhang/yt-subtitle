import React from "react";
import type { LyricCandidate } from "../shared/types";
import type {
  SearchGroupSnapshot,
  SearchRoute,
} from "../background/search-group";
import { lyricLines } from "../lyrics/preview";
import {
  SourceBadges,
  BrandLogo,
  candidateBrand,
  routeNames,
  usableCandidates,
} from "./SourceBadges";

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
  onUseSelected(): void;
  onSearchAgain(): void;
  onPaste(): void;
}) {
  const routes = (["comments", "web"] as const).map((route) => ({
    route,
    result: search?.routes[route],
    candidates: usableCandidates(search?.routes[route]?.candidates),
  }));
  const found = routes.some((r) => r.candidates.length);
  const said = routes.filter(
    (r) =>
      !r.candidates.length && r.result?.phase !== "pending" && r.result?.error,
  );
  return (
    <>
      <h3 className="subtitle-section-title">AI搜尋結果</h3>
      <SourceBadges search={search} />
      {found && (
        <fieldset className="subtitle-candidates" disabled={pending}>
          <legend>選擇字幕</legend>
          {routes.flatMap(({ route, candidates }) =>
            candidates.map((candidate) => {
              const lines = lyricLines(
                candidate.syncedLyrics ?? candidate.fullText,
              );
              return (
                <label key={route + candidate.id}>
                  <input
                    type="radio"
                    name="subtitle-candidate"
                    checked={
                      selected?.candidate.id === candidate.id &&
                      selected.route === route
                    }
                    onChange={() => onSelect({ candidate, route })}
                  />
                  <span>
                    <strong>
                      <BrandLogo {...candidateBrand(candidate, route)} />
                    </strong>
                    <span>
                      {candidate.title} {candidate.artist}
                    </span>
                    <small>
                      {candidate.language} · {lines.length} 行 ·{" "}
                      {candidate.syncedLyrics
                        ? "沿用時間碼"
                        : "無時間碼，使用後對齊整首"}
                    </small>
                    <small className="subtitle-preview">
                      {lines.slice(0, 3).join(" / ")}
                    </small>
                  </span>
                </label>
              );
            }),
          )}
        </fieldset>
      )}
      {said.map(({ route, result }) => (
        <div className="subtitle-ai-message" key={route}>
          <strong>{routeNames[route]}</strong>
          <p>{result!.error}</p>
          {result!.text && (
            <details>
              <summary>AI 原文</summary>
              <pre>{result!.text.slice(0, 4000)}</pre>
            </details>
          )}
        </div>
      ))}
      {selected && (
        <>
          <button
            className="primary"
            disabled={pending}
            onClick={onUseSelected}
          >
            使用所選字幕
          </button>
          <details open>
            <summary>所選歌詞預覽</summary>
            <pre>
              {selected.candidate.syncedLyrics ??
                selected.candidate.fullText ??
                "此來源未提供歌詞內容"}
            </pre>
          </details>
        </>
      )}
      {!searching && (
        <div className="subtitle-actions">
          {found ? (
            <button className="link" disabled={pending} onClick={onPaste}>
              找不到我要的 → 貼入歌詞
            </button>
          ) : (
            <button className="primary" disabled={pending} onClick={onPaste}>
              貼入歌詞
            </button>
          )}
          <button disabled={pending} onClick={onSearchAgain}>
            重新搜尋
          </button>
        </div>
      )}
    </>
  );
}
