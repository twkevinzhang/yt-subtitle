import type { SubtitleLine, SubtitleSource } from "../shared/types";
import { parseLyrics } from "./formats";
import { lockTiming } from "./timing-locks";

export function normalizeSubtitle(
  text: string,
  _source: SubtitleSource,
  durationMs: number,
): SubtitleLine[] {
  const cleaned = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const format = /-->/.test(cleaned)
    ? "srt"
    : /\[\d+:/.test(cleaned)
      ? "lrc"
      : "txt";
  return parseLyrics(new TextEncoder().encode(cleaned), format, durationMs, {
    allowPartial: true,
  }).map((line) =>
    lockTiming(
      {
        ...line,
        status:
          line.startMs !== undefined && line.endMs !== undefined
            ? "anchor"
            : "unaligned",
      },
      durationMs,
    ),
  );
}
