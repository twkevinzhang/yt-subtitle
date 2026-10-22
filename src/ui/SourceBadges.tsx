import React, { useState } from "react";
import type { PublicSettings, LyricCandidate } from "../shared/types";
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
export function candidateBrand(
  candidate: LyricCandidate,
  route: SearchRoute,
  settings: PublicSettings,
) {
  if (route === "comments") return { name: "YouTube", url: youtubeLogo };
  const source = settings.sources.find((s) => s.id === candidate.sourceId);
  if (source)
    return {
      name: source.name,
      url: "https://" + source.domain + "/favicon.ico",
    };
  try {
    return { name: new URL(candidate.url).hostname, url: undefined };
  } catch {
    return { name: "來源網站", url: undefined };
  }
}
export function SourceBadges({
  search,
  settings,
}: {
  search?: SearchGroupSnapshot;
  settings: PublicSettings;
}) {
  const entries = settings.sources
    .filter((s) => s.enabled)
    .map((s) => ({
      key: s.id,
      name: s.name,
      route: "configured" as SearchRoute,
      url: "https://" + s.domain + "/favicon.ico",
    }));
  entries.push(
    { key: "comments", name: "YouTube", route: "comments", url: youtubeLogo },
    {
      key: "web",
      name: "Google",
      route: "web",
      url: "https://www.google.com/favicon.ico",
    },
  );
  return (
    <div className="subtitle-badges" aria-label="搜尋狀態">
      {entries.map((entry) => {
        const result = search?.routes[entry.route];
        const candidates =
          result?.candidates.filter(
            (c) => entry.route !== "configured" || c.sourceId === entry.key,
          ) ?? [];
        const status =
          !result || result.phase === "pending"
            ? "搜尋中"
            : result.phase === "failed"
              ? "搜尋失敗"
              : result.phase === "cancelled"
                ? "已取消"
                : candidates.length
                  ? "找到 " + candidates.length + " 份"
                  : "沒有結果";
        return (
          <span
            key={entry.key}
            className={"subtitle-badge " + (candidates.length ? "done" : "")}
            title={entry.name + "：" + status}
          >
            <BrandLogo name={entry.name} url={entry.url} />
            <span>{status}</span>
          </span>
        );
      })}
    </div>
  );
}
