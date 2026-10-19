import type { RunState } from "../shared/types";
export async function startOwnedRun(
  start: () => Promise<RunState>,
  isAlive: () => boolean,
  cancel: (id: string) => Promise<void>,
): Promise<RunState> {
  if (!isAlive()) throw new Error("已離開影片");
  const state = await start();
  if (!isAlive()) {
    await cancel(state.runId);
    throw new Error("已離開影片，工作已取消");
  }
  return state;
}
