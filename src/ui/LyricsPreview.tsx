import React, { useEffect, useState } from "react";
import type { AlignedLine, DisplayMode } from "../shared/types";
export function LyricsPreview({
  lines,
  mode,
  offsetMs,
  video,
  seek,
}: {
  lines: AlignedLine[];
  mode: DisplayMode;
  offsetMs: number;
  video: HTMLVideoElement;
  seek: (ms: number) => void;
}) {
  const [time, setTime] = useState(video.currentTime * 1000);
  useEffect(() => {
    const update = () => setTime(video.currentTime * 1000);
    video.addEventListener("timeupdate", update);
    video.addEventListener("seeked", update);
    update();
    return () => {
      video.removeEventListener("timeupdate", update);
      video.removeEventListener("seeked", update);
    };
  }, [video]);
  return (
    <div className="lyrics-list" aria-label="整段歌詞">
      {lines
        .filter((l) => !l.excluded)
        .map((l) => {
          const active =
            l.startMs !== undefined &&
            l.endMs !== undefined &&
            time >= l.startMs + offsetMs &&
            time < l.endMs + offsetMs;
          return (
            <button
              key={l.id}
              className="lyric-line"
              aria-current={active ? "true" : undefined}
              disabled={l.startMs === undefined}
              onClick={() => seek(Math.max(0, l.startMs! + offsetMs))}
            >
              {mode !== "translation" && <span>{l.original}</span>}
              {mode !== "original" && (
                <span className="lyric-translation">
                  {l.translation || "尚無譯文"}
                </span>
              )}
              {l.startMs === undefined && <small>待校時</small>}
            </button>
          );
        })}
    </div>
  );
}
