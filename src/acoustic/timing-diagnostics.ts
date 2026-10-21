import type { SubtitleLine } from "../shared/types";
import type { JobKey, TimeRange } from "./contracts";

export type TimingStage =
  | "prepare"
  | "audio-wait"
  | "pcm-read"
  | "recognize"
  | "readings"
  | "match"
  | "align"
  | "verify"
  | "validate"
  | "cleanup";
export type OperationOutcome = "ok" | "failed" | "cancelled";
export type PendingEvidence =
  | "not-checked"
  | "unlocated"
  | "ambiguous"
  | "boundary-rejected"
  | "alignment-no-result"
  | "verification-no-match"
  | "audio-unavailable";
export interface TimingTotal {
  ms: number;
  calls: number;
  failed: number;
  cancelled: number;
}
export interface TimingOperation {
  stage: TimingStage;
  startMs: number;
  ms: number;
  outcome: OperationOutcome;
  range?: TimeRange;
}
export interface TimingWindow {
  startMs: number;
  range: TimeRange;
  pass: string;
  generation: number;
  ms: number;
  newlyTimed: number;
  outcome: OperationOutcome | "stale";
}
export type DecodeTimingObserver = (
  ms: number,
  outcome: "ok" | "failed",
) => void;
export interface TimingReport {
  schemaVersion: 1;
  notes: string[];
  runId: string;
  videoId: string;
  startedAt: string;
  elapsedMs: number;
  unattributedMs: number;
  outcome: "running" | "complete" | "partial" | "failed" | "cancelled";
  interruptedStage?: TimingStage;
  active?: { stage: TimingStage; elapsedMs: number; range?: TimeRange };
  initialTimed: number;
  newlyTimed: number;
  pendingCount: number;
  cache: { hits: number; misses: number };
  totals: Partial<Record<TimingStage, TimingTotal>>;
  decode: TimingTotal;
  operations: TimingOperation[];
  droppedOperations: number;
  windows: TimingWindow[];
  droppedWindows: number;
  pending: { lineId: string; row: number; evidence: PendingEvidence }[];
}
const timed = (lines: SubtitleLine[]) =>
  new Set(
    lines
      .filter(
        (l) => !l.excluded && l.startMs !== undefined && l.endMs !== undefined,
      )
      .map((l) => l.id),
  );

/** Monotonic wall durations, not CPU usage. Decode durations overlap audio wait. */
export function createTimingDiagnostics(
  key: JobKey,
  initialLines: SubtitleLine[],
  options: {
    now?: () => number;
    publish?: (report: TimingReport) => void;
    aborted?: () => boolean;
  } = {},
) {
  const now = options.now ?? (() => performance.now());
  const started = now();
  const initial = timed(initialLines);
  let lines = initialLines;
  let ended: number | undefined;
  let active:
    { stage: TimingStage; started: number; range?: TimeRange } | undefined;
  const evidence = new Map<string, PendingEvidence>();
  const report: TimingReport = {
    schemaVersion: 1,
    notes: [
      "所有耗時以單調時鐘計算，單位毫秒，並非 CPU 使用時間。",
      "totals 僅累計已結束呼叫；active 為目前呼叫，unattributedMs 為其他時間。",
      "decode 為解封裝／解碼管線呼叫時間，包含佇列等待，可能重疊，不可與主階段加總。",
      "pending.evidence 是最後觀察證據，不代表根因或是否演唱；區段候選可能涵蓋多句。",
      "每次啟動獨立計算；本報告不包含先前工作的耗時。",
    ],
    runId: key.runId,
    videoId: key.videoId,
    startedAt: new Date().toISOString(),
    elapsedMs: 0,
    unattributedMs: 0,
    outcome: "running",
    initialTimed: initial.size,
    newlyTimed: 0,
    pendingCount: 0,
    cache: { hits: 0, misses: 0 },
    totals: {},
    decode: { ms: 0, calls: 0, failed: 0, cancelled: 0 },
    operations: [],
    droppedOperations: 0,
    windows: [],
    droppedWindows: 0,
    pending: [],
  };
  const elapsed = () => Math.max(0, (ended ?? now()) - started);
  const snapshot = (): TimingReport => {
    const current = timed(lines);
    const elapsedMs = elapsed();
    const activeMs = active ? Math.max(0, now() - active.started) : 0;
    return structuredClone({
      ...report,
      elapsedMs,
      unattributedMs: Math.max(
        0,
        elapsedMs -
          Object.values(report.totals).reduce(
            (sum, total) => sum + total.ms,
            0,
          ) -
          activeMs,
      ),
      active: active
        ? {
            stage: active.stage,
            elapsedMs: activeMs,
            range: active.range,
          }
        : undefined,
      newlyTimed: [...current].filter((id) => !initial.has(id)).length,
      pendingCount: lines.filter((l) => !l.excluded && !current.has(l.id))
        .length,
      pending: lines.flatMap((l, i) =>
        !l.excluded && !current.has(l.id)
          ? [
              {
                lineId: l.id,
                row: i + 1,
                evidence: evidence.get(l.id) ?? "not-checked",
              },
            ]
          : [],
      ),
    });
  };
  const publish = () => {
    // Observability must never change alignment success/failure.
    if (!options.publish) return;
    try {
      options.publish(snapshot());
    } catch {
      /* consumer unavailable */
    }
  };
  const begin = (stage: TimingStage, range?: TimeRange) => {
    let start = now();
    active = { stage, started: start, range: range ? { ...range } : undefined };
    publish();
    // Serialization/React observer time belongs to overhead, not the model.
    start = now();
    active.started = start;
    return (outcome: OperationOutcome) => {
      const ms = Math.max(0, now() - start);
      const total = (report.totals[stage] ??= {
        ms: 0,
        calls: 0,
        failed: 0,
        cancelled: 0,
      });
      total.ms += ms;
      total.calls++;
      if (outcome !== "ok") {
        total[outcome]++;
        if (stage !== "cleanup" || !report.interruptedStage)
          report.interruptedStage = stage;
      }
      report.operations.push({
        stage,
        startMs: Math.max(0, start - started),
        ms,
        outcome,
        range: range ? { ...range } : undefined,
      });
      if (report.operations.length > 300) {
        report.operations.shift();
        report.droppedOperations++;
      }
      active = undefined;
      publish();
    };
  };
  return {
    snapshot,
    update(next: SubtitleLine[]) {
      lines = next;
    },
    cache(hit: boolean) {
      report.cache[hit ? "hits" : "misses"]++;
    },
    mark(ids: string[], reason: PendingEvidence) {
      for (const id of ids) evidence.set(id, reason);
    },
    measure<T>(stage: TimingStage, work: () => T, range?: TimeRange): T {
      const end = begin(stage, range);
      try {
        const result = work();
        end("ok");
        return result;
      } catch (error) {
        end(options.aborted?.() ? "cancelled" : "failed");
        throw error;
      }
    },
    async measureAsync<T>(
      stage: TimingStage,
      work: () => Promise<T>,
      range?: TimeRange,
    ): Promise<T> {
      const end = begin(stage, range);
      try {
        const result = await work();
        end("ok");
        return result;
      } catch (error) {
        end(options.aborted?.() ? "cancelled" : "failed");
        throw error;
      }
    },
    window(range: TimeRange, pass: string, generation: number) {
      const start = now(),
        before = timed(lines);
      return (outcome: TimingWindow["outcome"]) => {
        report.windows.push({
          startMs: Math.max(0, start - started),
          range: { ...range },
          pass,
          generation,
          ms: Math.max(0, now() - start),
          newlyTimed: [...timed(lines)].filter((id) => !before.has(id)).length,
          outcome,
        });
        if (report.windows.length > 200) {
          report.windows.shift();
          report.droppedWindows++;
        }
        publish();
      };
    },
    decode(ms: number, outcome: "ok" | "failed") {
      if (ended !== undefined || !Number.isFinite(ms) || ms < 0) return;
      report.decode.ms += ms;
      report.decode.calls++;
      if (outcome === "failed") report.decode.failed++;
    },
    finish(outcome: TimingReport["outcome"]) {
      report.outcome = outcome;
      ended = now();
      active = undefined;
      publish();
    },
  };
}
export type TimingDiagnostics = ReturnType<typeof createTimingDiagnostics>;
