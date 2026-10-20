import type { AlignedLine } from "../shared/types";
const blank = (text: string, index: number): AlignedLine => ({
  id: `l${index}`,
  original: text,
  cueIds: [],
  status: "unaligned",
  excluded: false,
});
export function parseLyrics(
  bytes: Uint8Array,
  format: "txt" | "lrc" | "srt",
  durationMs: number,
  options: { allowPartial?: boolean } = {},
): AlignedLine[] {
  if (bytes.byteLength > 2097152) throw new Error("檔案超過 2 MiB");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/\r/g, "")
      .trim();
  } catch {
    throw new Error("請使用 UTF-8 字幕檔");
  }
  if (!text) throw new Error("沒有歌詞內容");
  let lines: AlignedLine[] = [];
  if (format === "txt")
    lines = text
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
      .map(blank);
  else if (format === "srt") {
    for (const [i, block] of text.split(/\n\s*\n/).entries()) {
      if (options.allowPartial) {
        const partial = block.match(
          /^(?:\d+\n)?([^\n]*?)\s*-->\s*([^\n]*)\n([\s\S]+)$/,
        );
        if (!partial) throw new Error("SRT 格式錯誤");
        const endpoint = (value: string) => {
          const m = value
            .trim()
            .match(/^(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})(?:\s.*)?$/);
          return m && +m[2] < 60 && +m[3] < 60
            ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4]
            : undefined;
        };
        const startMs = endpoint(partial[1]),
          endMs = endpoint(partial[2]);
        lines.push({
          ...blank(partial[3].trim(), i),
          status: "manual",
          startMs,
          endMs,
          ...(startMs === undefined || endMs === undefined
            ? {
                timing: { warning: "無法解析部分時間碼，已保留文字與有效端點" },
              }
            : {}),
        });
        continue;
      }
      const match = block.match(
        /^(?:\d+\n)?(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})[^\n]*\n([\s\S]+)$/,
      );
      if (!match) throw new Error("SRT 格式錯誤");
      const at = (p: number) =>
        ((+match[p] * 60 + +match[p + 1]) * 60 + +match[p + 2]) * 1000 +
        +match[p + 3];
      lines.push({
        ...blank(match[9].trim(), i),
        status: "manual",
        startMs: at(1),
        endMs: at(5),
      });
    }
  } else {
    if (/<\d+:\d+/.test(text))
      throw new Error("首版不支援逐字 LRC，請貼入逐句 LRC");
    const offset = Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0);
    for (const row of text.split("\n")) {
      const stamps = [...row.matchAll(/\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
      const lyric = row.replace(/\[[^\]]*\]/g, "").trim();
      if (!stamps.length || !lyric) {
        if (options.allowPartial && lyric)
          lines.push({
            ...blank(lyric, lines.length),
            ...(/\[\d+:/.test(row)
              ? { timing: { warning: "無法解析時間碼，請補時或手動校正" } }
              : {}),
          });
        continue;
      }
      for (const m of stamps)
        lines.push({
          ...blank(lyric, lines.length),
          status: "manual",
          startMs:
            (+m[1] * 60 + +m[2]) * 1000 +
            Number((m[3] || "").padEnd(3, "0")) +
            offset,
        });
    }
    if (!options.allowPartial) lines.sort((a, b) => a.startMs! - b.startMs!);
    lines = lines.map((l, i) => ({
      ...l,
      id: `l${i}`,
      endMs: options.allowPartial
        ? lines
            .slice(i + 1)
            .find(
              (next) =>
                next.startMs !== undefined &&
                next.startMs > (l.startMs ?? Infinity) &&
                next.startMs <= durationMs,
            )?.startMs
        : (lines[i + 1]?.startMs ?? durationMs),
    }));
  }
  if (!lines.length) throw new Error("找不到有效歌詞");
  if (lines.length > 10000) throw new Error("超過 10,000 句上限");
  if (
    !options.allowPartial &&
    format !== "txt" &&
    validateTiming(lines, durationMs, 0).some((x) => x.severity === "error")
  )
    throw new Error("字幕時間無效或超出影片長度");
  return lines;
}
export interface TimingIssue {
  lineId: string;
  code: "unaligned" | "invalid-time" | "overlap";
  severity: "error" | "warning";
}
export function validateTiming(
  lines: AlignedLine[],
  durationMs: number,
  offsetMs: number,
): TimingIssue[] {
  const issues: TimingIssue[] = [];
  let previousEnd = -1;
  for (const l of lines.filter((l) => !l.excluded)) {
    if (
      l.status === "unaligned" ||
      l.startMs === undefined ||
      l.endMs === undefined
    ) {
      issues.push({ lineId: l.id, code: "unaligned", severity: "error" });
      continue;
    }
    const a = l.startMs + offsetMs,
      b = l.endMs + offsetMs;
    if (
      !Number.isFinite(a) ||
      !Number.isFinite(b) ||
      a < 0 ||
      b <= a ||
      b > durationMs
    )
      issues.push({ lineId: l.id, code: "invalid-time", severity: "error" });
    if (a < previousEnd)
      issues.push({ lineId: l.id, code: "overlap", severity: "warning" });
    previousEnd = b;
  }
  return issues;
}
