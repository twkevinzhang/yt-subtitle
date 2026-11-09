import type { CacheEntry } from "../subtitle/cache-store";
export const formatDuration = (ms: number) => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};
export const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
/** Parts shown on the second line; anything unknown is simply left out. */
export const cacheDetails = (entry: CacheEntry) =>
  [
    entry.channel,
    entry.durationMs ? formatDuration(entry.durationMs) : "",
    entry.audioBytes ? formatSize(entry.audioBytes) : "",
    entry.resultCount ? `${entry.resultCount} 組歌詞` : "",
    new Date(entry.lastUsed).toLocaleString("zh-TW", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  ].filter(Boolean);
