import React, { useState, useId } from "react";
import {
  toDashboardSteps,
  type JobSnapshot,
  type StepStatus,
} from "../subtitle/job-state";
import type { WorkTranslation } from "../subtitle/coordinator";
export const stepLabels = [
  "尋找字幕",
  "取得音訊",
  "準備語音模型",
  "對齊歌詞",
  "套用字幕",
];
const TRANSLATE_ICON = 5;
const paths = [
  "M21 21l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  "M12 3v12 M7 10l5 5 5-5 M5 16v5h14v-5",
  "M8 8h8v8H8z M9 3H5v4 M15 3h4v4 M9 21H5v-4 M15 21h4v-4 M1 10h4 M19 10h4 M1 14h4 M19 14h4",
  "M4 5v14 M9 8v8 M14 3v18 M19 7v10",
  "M3 5h18v14H3z M6 13h5 M14 13h4 M6 16h3 M12 16h6",
  "M4 5h9 M8.5 3v2 M6 5c.5 3 2.5 5 5.5 6.5 M11 5c-.5 3-2.5 5-6 7 M13 21l4-10 4 10 M14.5 17.5h5",
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
export interface Station {
  id: string;
  status: StepStatus;
  icon: number;
  label: string;
}
/** The job's steps, with a translation step before applying when one was asked for. */
export function stationsFor(
  job: JobSnapshot,
  translation?: Pick<WorkTranslation, "phase">,
): Station[] {
  const stations = toDashboardSteps(job).map((step, i) => ({
    id: step.id,
    status: step.status,
    icon: i,
    label: stepLabels[i]!,
  }));
  if (translation)
    stations.splice(4, 0, {
      id: "translate",
      status:
        translation.phase === "failed"
          ? "failed"
          : translation.phase === "done"
            ? "done"
            : "active",
      icon: TRANSLATE_ICON,
      label: "翻譯",
    });
  return stations;
}
export function ProgressSteps({
  job,
  translation,
}: {
  job: JobSnapshot;
  translation?: Pick<WorkTranslation, "phase">;
}) {
  const stations = stationsFor(job, translation);
  const [tip, setTip] = useState<number | null>(null);
  const id = useId();
  return (
    <div
      className="subtitle-rail"
      aria-label="字幕處理進度"
      style={{ "--stations": stations.length } as React.CSSProperties}
    >
      {stations.map((step, i) => (
        <div
          key={step.id}
          className={"subtitle-station " + step.status}
          onMouseEnter={() => setTip(i)}
          onMouseLeave={() => setTip(null)}
        >
          <button
            type="button"
            aria-label={step.label + "：" + statusNames[step.status]}
            aria-current={step.status === "active" ? "step" : undefined}
            aria-describedby={tip === i ? id + i : undefined}
            onFocus={() => setTip(i)}
            onBlur={() => setTip(null)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setTip(null);
            }}
          >
            <StepIcon index={step.icon} />
          </button>
          {tip === i && (
            <span className="subtitle-tip" role="tooltip" id={id + i}>
              {step.label}
              <br />
              {statusNames[step.status]}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
