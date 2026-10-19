import type { RunState } from "../shared/types";
export interface RunRecord {
  state: RunState;
  output?: unknown;
  partial?: unknown;
  alignmentReport?: string;
  responseText?: string;
}
export interface RunTools {
  signal: AbortSignal;
  request<T>(fn: () => Promise<T>): Promise<T>;
  progress(ids: string[], partial?: unknown): Promise<void>;
  response(text: string): Promise<void>;
  trace(text: string, verdict?: boolean): Promise<void>;
}
export class RunManager {
  private records = new Map<string, RunRecord>();
  private controllers = new Map<string, AbortController>();
  private busy = false;
  constructor(private persist: (record: RunRecord) => Promise<void>) {}
  get(id: string) {
    return this.records.get(id);
  }
  start(
    tabId: number,
    videoId: string,
    revision: number,
    job: (tools: RunTools) => Promise<unknown>,
    phase: "searching" | "aligning" = "aligning",
  ): RunState {
    if (this.busy) throw new Error("已有工作正在處理，請先取消或等待完成");
    this.busy = true;
    const runId = crypto.randomUUID(),
      controller = new AbortController();
    const state: RunState = {
      schemaVersion: 1,
      runId,
      tabId,
      videoId,
      settingsRevision: revision,
      phase,
      startedAt: Date.now(),
      deadlineAt: Date.now() + 600000,
      requestCount: 0,
      completedLineIds: [],
    };
    const record: RunRecord = { state };
    let rawTrace = "",
      finalTrace = "",
      rawTruncated = false;
    this.records.set(runId, record);
    this.controllers.set(runId, controller);
    for (const [id, r] of this.records)
      if (this.records.size > 2 && !this.controllers.has(id))
        this.records.delete(id);
    const timer = setTimeout(() => controller.abort(), 600000);
    const check = () => {
      if (controller.signal.aborted || Date.now() >= state.deadlineAt)
        throw new Error("工作已取消或達時間上限");
    };
    void (async () => {
      try {
        await this.persist(record);
        const output = await job({
          signal: controller.signal,
          response: async (text) => {
            check();
            record.responseText = text;
            await this.persist(record);
          },
          trace: async (text, verdict = false) => {
            check();
            if (verdict)
              finalTrace =
                text.slice(0, 20000) +
                (text.length > 20000 ? "\n［判定達上限，後續已截斷］" : "");
            else {
              const joined = rawTrace + text + "\n";
              rawTruncated ||= joined.length > 18000;
              rawTrace = joined.slice(-18000);
            }
            record.alignmentReport =
              (rawTruncated ? "［較早的原始回覆已截斷，保留最新批次］\n" : "") +
              rawTrace +
              "\n" +
              finalTrace;
            await this.persist(record);
          },
          request: async (fn) => {
            check();
            if (state.requestCount >= 20) throw new Error("已達 20 次請求上限");
            state.requestCount++;
            await this.persist(record);
            const result = await fn();
            check();
            return result;
          },
          progress: async (ids, partial) => {
            check();
            state.completedLineIds = [
              ...new Set([...state.completedLineIds, ...ids]),
            ];
            record.partial = partial;
            await this.persist(record);
          },
        });
        check();
        record.output = output;
        state.phase = "complete";
      } catch (e) {
        state.phase = controller.signal.aborted ? "cancelled" : "failed";
        state.errorCode = e instanceof Error ? e.message : "工作未完成";
      } finally {
        clearTimeout(timer);
        this.controllers.delete(runId);
        this.busy = false;
        try {
          await this.persist(record);
        } catch {
          if (state.phase !== "complete") state.phase = "failed";
          state.errorCode = "工作暫存失敗，請及時保存結果或重新載入擴充功能";
        }
      }
    })();
    return { ...state };
  }
  cancel(id: string) {
    const r = this.records.get(id);
    if (r && this.controllers.has(id)) {
      r.state.phase = "cancelled";
      this.controllers.get(id)?.abort();
      void this.persist(r).catch(() => {});
    }
  }
  cancelTab(tabId: number) {
    for (const [id, r] of this.records)
      if (r.state.tabId === tabId) this.cancel(id);
  }
  cancelAll() {
    for (const id of this.controllers.keys()) this.cancel(id);
  }
}
