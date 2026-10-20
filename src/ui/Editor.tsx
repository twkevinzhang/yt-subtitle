import React from "react";
import type { AlignedLine } from "../shared/types";
export function Editor({
  lines,
  onChange,
  currentMs,
  seek,
  lineOffset = 0,
  disabled = false,
}: {
  lineOffset?: number;
  disabled?: boolean;
  lines: AlignedLine[];
  onChange: (value: AlignedLine[]) => void;
  currentMs: () => number;
  seek: (ms: number) => void;
}) {
  const edit = (id: string, patch: Partial<AlignedLine>) => {
    if (disabled) return;
    onChange(
      lines.map((l) => {
        if (l.id !== id) return l;
        if (patch.original !== undefined && l.alignmentText !== undefined) {
          const rows = patch.original.split(/\r?\n/);
          patch = {
            ...patch,
            alignmentText:
              rows.length > 1 &&
              rows.slice(1).every((row) => /^[（(].*[)）]$/u.test(row.trim()))
                ? rows[0]
                : undefined,
          };
        }
        const changesTime =
          Object.prototype.hasOwnProperty.call(patch, "startMs") ||
          Object.prototype.hasOwnProperty.call(patch, "endMs");
        return {
          ...l,
          ...patch,
          ...(changesTime ? { timing: undefined } : {}),
        };
      }),
    );
  };
  return (
    <section>
      <h3>逐句預覽與校時</h3>
      <p className="muted">
        時間單位為秒；未對齊句子需校時或排除。估算時間請聆聽確認。
      </p>
      {lines.map((l, i) => (
        <article key={l.id} className="editor-row">
          <div className="row">
            <strong>第 {i + 1 + lineOffset} 句</strong>
            <small>
              {
                {
                  unaligned: "未對齊",
                  estimated: "待校時（估算）",
                  anchor: "字幕錨點",
                  manual: "手動時間",
                }[l.status]
              }
            </small>
            <label>
              <input
                type="checkbox"
                disabled={disabled}
                checked={l.excluded}
                onChange={(e) => edit(l.id, { excluded: e.target.checked })}
              />
              排除這句
            </label>
          </div>
          {l.timing?.warning && <p className="muted">{l.timing.warning}</p>}
          <label>
            <span>原文</span>
            <textarea
              disabled={disabled}
              value={l.original}
              onChange={(e) => edit(l.id, { original: e.target.value })}
            />
          </label>
          {l.translation !== undefined && (
            <label>
              <span>譯文</span>
              <textarea
                disabled={disabled}
                value={l.translation}
                onChange={(e) => edit(l.id, { translation: e.target.value })}
              />
            </label>
          )}
          <div className="row">
            <label>
              開始{" "}
              <input
                aria-label={`第 ${i + 1 + lineOffset} 句開始秒數`}
                type="number"
                disabled={disabled}
                min="0"
                step="0.001"
                value={l.startMs === undefined ? "" : l.startMs / 1000}
                onChange={(e) =>
                  edit(l.id, {
                    startMs:
                      e.target.value === ""
                        ? undefined
                        : Math.round(Number(e.target.value) * 1000),
                    status: "manual",
                  })
                }
              />
            </label>
            <label>
              結束{" "}
              <input
                aria-label={`第 ${i + 1 + lineOffset} 句結束秒數`}
                type="number"
                disabled={disabled}
                min="0"
                step="0.001"
                value={l.endMs === undefined ? "" : l.endMs / 1000}
                onChange={(e) =>
                  edit(l.id, {
                    endMs:
                      e.target.value === ""
                        ? undefined
                        : Math.round(Number(e.target.value) * 1000),
                    status: "manual",
                  })
                }
              />
            </label>
            <button
              disabled={l.startMs === undefined}
              onClick={() => seek(l.startMs!)}
            >
              播放這句
            </button>
          </div>
          <div className="row time-controls">
            <button
              disabled={disabled}
              onClick={() =>
                edit(l.id, { startMs: currentMs(), status: "manual" })
              }
            >
              以目前位置設開始
            </button>
            <button
              disabled={disabled}
              onClick={() =>
                edit(l.id, { endMs: currentMs(), status: "manual" })
              }
            >
              以目前位置設結束
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
