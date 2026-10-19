import type { RunRecord } from "./runs";
interface SessionStore {
  get(keys: null): Promise<Record<string, any>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}
export class RunJournal {
  private queue: Promise<void> = Promise.resolve();
  constructor(private store: SessionStore) {}
  async restore() {
    const all = await this.store.get(null);
    const records = Object.entries(all)
      .filter(([key, r]) => key.startsWith("run:") && r?.state?.runId)
      .map(([, r]) => r as RunRecord)
      .sort((a, b) => b.state.startedAt - a.state.startedAt);
    const latest = records[0];
    if (!latest) return;
    if (["searching", "aligning"].includes(latest.state.phase)) {
      latest.state.phase = "interrupted";
      latest.state.errorCode = "背景程序已中斷，請手動重試";
    }
    await this.persist(latest);
  }
  persist(record: RunRecord): Promise<void> {
    const snapshot = structuredClone(record);
    if (snapshot.state.errorCode)
      snapshot.state.errorCode = snapshot.state.errorCode.slice(0, 600);
    if (snapshot.output !== undefined || snapshot.acoustic)
      delete snapshot.partial;
    // Under Chrome 102–111's 1 MiB session quota; full output remains in RunManager memory.
    if (
      new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > 262144
    ) {
      delete snapshot.responseText;
      delete snapshot.output;
      delete snapshot.partial;
      delete snapshot.acoustic;
      delete snapshot.alignmentReport;
      if (["complete", "aligning"].includes(snapshot.state.phase)) {
        snapshot.state.phase = "interrupted";
        snapshot.state.errorCode = "結果超過背景暫存上限，請重新處理並及時保存";
      }
    }
    const next = this.queue.then(async () => {
      const all = await this.store.get(null);
      const obsolete = Object.keys(all).filter(
        (k) => k.startsWith("run:") && k !== "run:" + snapshot.state.runId,
      );
      if (obsolete.length) await this.store.remove(obsolete);
      await this.store.set({ ["run:" + snapshot.state.runId]: snapshot });
    });
    this.queue = next.catch(() => {});
    return next;
  }
}
