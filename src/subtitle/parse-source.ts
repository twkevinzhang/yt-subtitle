import type { SelectedSource } from "./types";
/** Parse timestamps only. LRC without explicit ends is rejected rather than interpolated. */
export function parseSource(
  text: string,
  languageHint?: string,
): SelectedSource {
  if (!text.includes("-->") && !/\[\d+:\d/u.test(text))
    return { rawText: text, languageHint };
  if (!text.includes("-->"))
    throw Error(
      "這份 LRC 缺少明確結束時間，請改選含完整時間碼的 SRT 或原文歌詞。",
    );
  const rawLines: string[] = [],
    timings: NonNullable<SelectedSource["timings"]>[number][] = [];
  const timestamp = (value: string) => {
    const match = value.match(/^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})$/u);
    if (!match) throw Error("字幕時間碼格式無效");
    return +match[1] * 3600 + +match[2] * 60 + +match[3] + +match[4] / 1000;
  };
  for (const block of text
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .split(/\n\s*\n/u)) {
    if (!block.trim()) continue;
    const lines = block.split("\n");
    if (/^\d+$/u.test(lines[0])) lines.shift();
    const range = lines.shift()?.split(/\s*-->\s*/u);
    if (range?.length !== 2 || !lines.length) throw Error("SRT 格式無效");
    const start = timestamp(range[0]),
      end = timestamp(range[1]);
    for (const line of lines) {
      const sourceLineIndex = rawLines.length;
      rawLines.push(line);
      if (line.trim()) timings.push({ sourceLineIndex, start, end });
    }
  }
  return { rawText: rawLines.join("\n"), languageHint, timings };
}
