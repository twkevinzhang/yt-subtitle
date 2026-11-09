import React, { useState } from "react";
import type { LyricCandidate } from "../shared/types";
import { lyricLines, MIN_LYRIC_LINES } from "../lyrics/preview";
import type {
  SearchGroupSnapshot,
  SearchRoute,
} from "../background/search-group";
const youtubeLogo =
  "https://www.youtube.com/s/desktop/12d6b690/img/favicon_32x32.png";
export function BrandLogo({ name, url }: { name: string; url?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <>
      {url && !failed && (
        <img
          src={url}
          alt=""
          width="18"
          height="18"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      )}
      <span>{name}</span>
    </>
  );
}
export function candidateBrand(candidate: LyricCandidate, route: SearchRoute) {
  if (route === "comments") return { name: "YouTube", url: youtubeLogo };
  try {
    return { name: new URL(candidate.url).hostname, url: undefined };
  } catch {
    return { name: "來源網站", url: undefined };
  }
}
export const routeNames: Record<SearchRoute, string> = {
  comments: "YouTube",
  web: "Google",
};
const routeLogos: Record<SearchRoute, string> = {
  comments: youtubeLogo,
  web: "https://www.google.com/favicon.ico",
};
/** Candidates with lyric text to align; results saved by older builds may have none. */
export function usableCandidates(candidates: readonly LyricCandidate[] = []) {
  return candidates.filter(
    (c) => lyricLines(c.syncedLyrics ?? c.fullText).length >= MIN_LYRIC_LINES,
  );
}
/**
 * Tags name the sources the AI actually returned lyrics from. With none, there
 * is nothing to tag; the AI's own reply is shown instead. A source that found
 * nothing is kept only as a quiet note next to the ones that did.
 */
export function SourceBadges({ search }: { search?: SearchGroupSnapshot }) {
  const rows = (["comments", "web"] as const).map((route) => ({
    route,
    count: usableCandidates(search?.routes[route]?.candidates).length,
    pending: search?.routes[route]?.phase === "pending",
  }));
  if (!rows.some((row) => row.count)) return null;
  return (
    <div className="subtitle-badges" aria-label="搜尋結果來源">
      {rows.map((row) =>
        row.count ? (
          <span
            key={row.route}
            className="subtitle-badge done"
            title={routeNames[row.route] + "：找到 " + row.count + " 份"}
          >
            <BrandLogo
              name={routeNames[row.route]}
              url={routeLogos[row.route]}
            />
            <span>找到 {row.count} 份</span>
          </span>
        ) : (
          <span key={row.route} className="subtitle-badge quiet">
            {routeNames[row.route]} {row.pending ? "搜尋中" : "沒有結果"}
          </span>
        ),
      )}
    </div>
  );
}
