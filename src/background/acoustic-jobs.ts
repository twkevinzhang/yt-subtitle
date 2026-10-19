import type { AlignedLine, Cue } from "../shared/types";
import type { RunTools, RunRecord } from "./runs";
import {
  assertJobKey,
  type AlignmentSnapshot,
  type JobKey,
} from "../acoustic/contracts";
import { parseRegionPlan } from "../lyrics/region-request";
type Host = (command: string, args?: Record<string, unknown>) => Promise<any>;

export async function followAcousticJob(
  key: JobKey,
  tools: RunTools,
  host: Host,
  wait = () => new Promise<void>((r) => setTimeout(r, 500)),
) {
  let sequence = -1;
  let lifecycle = "";
  let completed = false;
  const cancel = () => {
    void host("cancel", { key }).catch(() => {});
  };
  tools.signal.addEventListener("abort", cancel, { once: true });
  try {
    while (!tools.signal.aborted) {
      const status = await host("query");
      if (tools.signal.aborted) break;
      const snapshot = status.snapshot as AlignmentSnapshot | undefined;
      if (status.phase === "preparing") {
        assertJobKey(key, status.key);
        await wait();
        continue;
      }
      if (!snapshot) throw new Error("聲學工作已中斷，請重新校時");
      assertJobKey(key, snapshot.key);
      const nextLifecycle = JSON.stringify([
        status.phase,
        snapshot.modelState,
        snapshot.segments,
      ]);
      if (
        snapshot.sequence > sequence ||
        (snapshot.sequence === sequence && nextLifecycle !== lifecycle)
      ) {
        await tools.acoustic(snapshot);
        sequence = snapshot.sequence;
        lifecycle = nextLifecycle;
      }
      if (["complete", "partial"].includes(status.phase)) {
        completed = true;
        return snapshot.lines;
      }
      if (["failed", "cancelled", "idle"].includes(status.phase))
        throw new Error(status.error || "部分片段尚待校時；已完成結果保留");
      await wait();
    }
    throw new Error("工作已取消");
  } finally {
    tools.signal.removeEventListener("abort", cancel);
    if (!completed) await host("cancel", { key }).catch(() => {});
  }
}
export async function recoveryOwner(
  status: any,
  record: RunRecord | undefined,
  ownsTab: (key: JobKey) => Promise<boolean>,
  cancel: (key: JobKey) => Promise<void>,
) {
  const key: JobKey | undefined = status.key ?? status.snapshot?.key;
  if (!key) return;
  if (
    record &&
    record.state.runId === key.runId &&
    record.state.tabId === key.tabId &&
    record.state.videoId === key.videoId &&
    record.state.deadlineAt > Date.now() &&
    ["aligning", "interrupted"].includes(record.state.phase) &&
    (await ownsTab(key))
  )
    return record;
  if (["running", "preparing"].includes(status.phase)) await cancel(key);
}

export async function runAcousticAlignment(
  input: {
    key: JobKey;
    assetId: string;
    lines: AlignedLine[];
    cues: Cue[];
    durationMs: number;
    body: unknown;
    positionMs: number;
  },
  tools: RunTools,
  deps: {
    complete(body: any, signal: AbortSignal): Promise<string>;
    host: Host;
    wait?: () => Promise<void>;
  },
) {
  await tools.trace(
    "正在以 AI 定位完整樂句區間；逐句時間由本機 WASM 模型計算。",
  );
  const raw = await tools.request(() =>
    deps.complete(input.body, tools.signal),
  );
  await tools.response(raw);
  let payload: unknown;
  try {
    payload = JSON.parse(
      raw.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""),
    );
  } catch {
    throw new Error("AI 區間定位回覆不是有效 JSON，原始回覆已保留");
  }
  const plan = parseRegionPlan(
    payload,
    input.lines,
    input.cues,
    input.durationMs,
  );
  if (!plan.segments.length)
    throw new Error("AI 未取得可用段落定位；歌詞與原始回覆已保留");
  const owned = new Set(plan.segments.flatMap((s) => s.lineIds));
  await tools.progress([], plan.lines);
  await tools.trace(
    `已定位 ${owned.size} 句、${plan.segments.length} 個片段；${plan.lines.filter((l) => !l.excluded && !owned.has(l.id)).length} 句缺少定位，保留待處理。正在準備本機模型。`,
  );
  if (tools.signal.aborted) throw new Error("工作已取消");
  await deps.host("start", {
    input: {
      key: input.key,
      assetId: input.assetId,
      lines: plan.lines,
      segments: plan.segments,
      cues: input.cues,
      positionMs: tools.positionMs?.() ?? input.positionMs,
      encoding: "compressed",
      durationMs: input.durationMs,
    },
  });
  const lines = await followAcousticJob(input.key, tools, deps.host, deps.wait);
  return { lines, response: raw };
}
