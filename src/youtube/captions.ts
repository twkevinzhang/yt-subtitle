import type { Cue } from "../shared/types";
export function parseYouTubeCaptions(
  raw: string,
  format: "json3" | "srv3",
): Cue[] {
  if (raw.length > 4 * 1024 * 1024) throw new Error("字幕資料過大");
  let cues: Cue[] = [];
  if (format === "json3") {
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        "YouTube 未回傳有效字幕內容，請啟用原生字幕後重試，或匯入 LRC／SRT",
      );
    }
    cues = (data.events || [])
      .filter((e: any) => e.segs && e.dDurationMs > 0)
      .map((e: any, i: number) => ({
        id: `c${i}`,
        startMs: Number(e.tStartMs),
        endMs: Number(e.tStartMs) + Number(e.dDurationMs),
        text: e.segs
          .map((s: any) => s.utf8 || "")
          .join("")
          .trim(),
        ...(e.segs.some((s: any) => s.tOffsetMs !== undefined)
          ? {
              tokens: e.segs
                .filter(
                  (s: any) =>
                    typeof s.utf8 === "string" &&
                    s.utf8.trim() &&
                    Number.isFinite(s.tOffsetMs ?? 0) &&
                    (s.tOffsetMs ?? 0) >= 0,
                )
                .map((s: any) => ({
                  text: s.utf8,
                  startMs: Number(e.tStartMs) + (s.tOffsetMs ?? 0),
                })),
            }
          : {}),
      }));
  } else {
    const doc = new DOMParser().parseFromString(raw, "text/xml");
    if (doc.querySelector("parsererror")) throw new Error("字幕 XML 格式錯誤");
    cues = [...doc.querySelectorAll("p")].map((p, i) => ({
      id: `c${i}`,
      startMs: Number(p.getAttribute("t")),
      endMs: Number(p.getAttribute("t")) + Number(p.getAttribute("d")),
      text: p.textContent?.trim() || "",
    }));
  }
  cues = cues.filter(
    (c) =>
      c.text &&
      Number.isFinite(c.startMs) &&
      Number.isFinite(c.endMs) &&
      c.startMs >= 0 &&
      c.endMs > c.startMs,
  );
  if (!cues.length || cues.length > 20000)
    throw new Error("未取得有效字幕，請啟用原生字幕後重試");
  // Merge only exact same-window duplicate/rolling updates; later repetitions remain distinct.
  const merged: Cue[] = [];
  for (const c of cues) {
    const prev = merged.at(-1);
    if (
      prev &&
      prev.startMs === c.startMs &&
      prev.endMs === c.endMs &&
      (c.text.startsWith(prev.text) || prev.text.startsWith(c.text))
    ) {
      if (c.text.length > prev.text.length) prev.text = c.text;
    } else merged.push(c);
  }
  return merged;
}
