import React, { useState, useId } from "react";
import { toDashboardSteps, type JobSnapshot } from "../subtitle/job-state";
export const stepLabels = [
  "尋找字幕",
  "取得音訊",
  "準備語音模型",
  "對齊歌詞",
  "套用字幕",
];
const paths = [
  "M21 21l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  "M12 3v12 M7 10l5 5 5-5 M5 16v5h14v-5",
  "M8 8h8v8H8z M9 3H5v4 M15 3h4v4 M9 21H5v-4 M15 21h4v-4 M1 10h4 M19 10h4 M1 14h4 M19 14h4",
  "M4 5v14 M9 8v8 M14 3v18 M19 7v10",
  "M3 5h18v14H3z M6 13h5 M14 13h4 M6 16h3 M12 16h6",
];
export function StepIcon({ index }: { index: number }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[index]} />
    </svg>
  );
}
const statusNames = {
  waiting: "等待",
  active: "處理中",
  done: "已完成",
  failed: "失敗",
  skipped: "不需要",
};
export function ProgressSteps({ job }: { job: JobSnapshot }) {
  const [tip, setTip] = useState<number | null>(null);
  const id = useId();
  return (
    <div className="subtitle-rail" aria-label="字幕處理進度">
      {toDashboardSteps(job).map((step, i) => (
        <div
          key={step.id}
          className={"subtitle-station " + step.status}
          onMouseEnter={() => setTip(i)}
          onMouseLeave={() => setTip(null)}
        >
          <button
            type="button"
            aria-label={stepLabels[i] + "：" + statusNames[step.status]}
            aria-current={step.status === "active" ? "step" : undefined}
            aria-describedby={tip === i ? id + i : undefined}
            onFocus={() => setTip(i)}
            onBlur={() => setTip(null)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setTip(null);
            }}
          >
            <StepIcon index={i} />
          </button>
          {tip === i && (
            <span className="subtitle-tip" role="tooltip" id={id + i}>
              {stepLabels[i]}
              <br />
              {statusNames[step.status]}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
