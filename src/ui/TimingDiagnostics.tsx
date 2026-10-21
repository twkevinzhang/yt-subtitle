import React, { useEffect, useMemo, useState } from "react";
import type {
  TimingReport,
  TimingStage,
  PendingEvidence,
} from "../acoustic/timing-diagnostics";

const stageNames: Record<TimingStage, string> = {
  prepare: "模型載入",
  "audio-wait": "音訊等待（含解碼等待）",
  "pcm-read": "PCM 讀取",
  recognize: "語音辨識",
  readings: "讀音轉換",
  match: "文字匹配",
  align: "聲學對齊",
  verify: "缺口聲學驗證",
  validate: "邊界驗證",
  cleanup: "資源清理",
};
const evidenceNames: Record<PendingEvidence, string> = {
  "not-checked": "尚無逐句檢查證據",
  unlocated: "候選區段未定位",
  ambiguous: "重複段落歧義",
  "boundary-rejected": "結果未通過邊界驗證",
  "alignment-no-result": "對齊未回傳完整時間",
  "verification-no-match": "缺口驗證未接受此句",
  "audio-unavailable": "候選區段音訊取得失敗",
};
const outcomeNames = {
  running: "進行中",
  complete: "完成",
  partial: "部分完成",
  failed: "失敗",
  cancelled: "已取消",
};
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`;

export function TimingDiagnostics({ report }: { report: TimingReport }) {
  const [extraMs, setExtraMs] = useState(0);
  const receivedAt = useMemo(() => performance.now(), [report]);
  useEffect(() => {
    setExtraMs(0);
    if (report.outcome !== "running") return;
    const timer = setInterval(
      () => setExtraMs(Math.max(0, performance.now() - receivedAt)),
      1000,
    );
    return () => clearInterval(timer);
  }, [report, receivedAt]);
  const liveExtra = report.outcome === "running" ? extraMs : 0;
  const download = () => {
    const downloadExtra =
      report.outcome === "running"
        ? Math.max(0, performance.now() - receivedAt)
        : 0;
    const value = {
      ...report,
      elapsedMs: report.elapsedMs + downloadExtra,
      active: report.active
        ? {
            ...report.active,
            elapsedMs: report.active.elapsedMs + downloadExtra,
          }
        : undefined,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], {
        type: "application/json;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `alignment-diagnostics-${report.videoId}-${report.runId}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <details className="timing-diagnostics">
      <summary>補時診斷</summary>
      <p>
        本次耗時 {seconds(report.elapsedMs + liveExtra)} ·{" "}
        {outcomeNames[report.outcome]}
      </p>
      <p>
        開始時已有 {report.initialTimed} 句 · 本次新增 {report.newlyTimed} 句 ·
        待處理 {report.pendingCount} 句
      </p>
      {report.active && (
        <p>
          目前：{stageNames[report.active.stage]}，已持續{" "}
          {seconds(report.active.elapsedMs + liveExtra)}
        </p>
      )}
      {report.interruptedStage && (
        <p>曾失敗或取消的階段：{stageNames[report.interruptedStage]}</p>
      )}
      <p className="muted">
        以下累計已結束的呼叫；總耗時另含排程與報告處理時間。單位為實際經過時間，不是
        CPU 使用時間。
      </p>
      <table style={{ width: "100%", fontSize: "0.85em" }}>
        <caption>階段耗時</caption>
        <thead>
          <tr>
            <th scope="col">階段</th>
            <th scope="col">耗時</th>
            <th scope="col">次數</th>
            <th scope="col">失敗／取消</th>
          </tr>
        </thead>
        <tbody>
          {(Object.entries(stageNames) as [TimingStage, string][]).map(
            ([stage, name]) => {
              const total = report.totals[stage];
              return (
                <tr key={stage}>
                  <th scope="row">{name}</th>
                  <td>{seconds(total?.ms ?? 0)}</td>
                  <td>{total?.calls ?? 0}</td>
                  <td>
                    {total?.failed ?? 0}／{total?.cancelled ?? 0}
                  </td>
                </tr>
              );
            },
          )}
        </tbody>
      </table>
      <p>
        其他時間（排程、診斷與未歸類處理）：{seconds(report.unattributedMs)}
      </p>
      <p>
        辨識快取：命中 {report.cache.hits} 次 · 未命中 {report.cache.misses} 次
      </p>
      <p>
        解封裝／解碼管線呼叫（含佇列等待）：{seconds(report.decode.ms)}，
        {report.decode.calls} 次，失敗 {report.decode.failed}{" "}
        次；可能與音訊等待或其他階段重疊，請勿加總。
      </p>
      <details>
        <summary>最近區段產出（顯示最近 20 筆）</summary>
        <ol
          style={{
            maxHeight: 180,
            overflowY: "auto",
            overflowWrap: "anywhere",
          }}
        >
          {report.windows.slice(-20).map((w, i) => (
            <li key={i}>
              {(w.range.startMs / 1000).toFixed(1)}–
              {(w.range.endMs / 1000).toFixed(1)} 秒 · {w.pass} ·{" "}
              {seconds(w.ms)} · 新增 {w.newlyTimed} 句 · {w.outcome}
            </li>
          ))}
        </ol>
      </details>
      <details>
        <summary>待處理句子的最後觀察證據（{report.pendingCount} 句）</summary>
        <p className="muted">
          候選範圍可能涵蓋多句；這些證據不能單獨判定根因或是否演唱。
        </p>
        <ul style={{ maxHeight: 180, overflowY: "auto" }}>
          {report.pending.map((row) => (
            <li key={row.lineId}>
              第 {row.row} 行：{evidenceNames[row.evidence]}
            </li>
          ))}
        </ul>
      </details>
      <p className="muted">
        只保留本次診斷，不含歌詞、辨識文字或音訊；關閉或重新整理面板前請下載。JSON
        保留最近 300 筆操作及 200 個區段，累計值持續保留。
      </p>
      {(report.droppedOperations > 0 || report.droppedWindows > 0) && (
        <p>
          已省略較早操作 {report.droppedOperations} 筆、區段{" "}
          {report.droppedWindows} 筆。
        </p>
      )}
      <button type="button" onClick={download}>
        下載診斷 JSON
      </button>
    </details>
  );
}
