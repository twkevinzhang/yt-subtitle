import { it, expect } from "vitest";
import { RunJournal } from "../../src/background/run-journal";
function store() {
  const entries: Record<string, any> = {};
  return {
    entries,
    get: async () => ({ ...entries }),
    set: async (value: any) => {
      Object.assign(entries, value);
    },
    remove: async (keys: string[]) => {
      keys.forEach((k) => delete entries[k]);
    },
  };
}
const record = (id: string) => ({
  state: {
    schemaVersion: 1 as const,
    runId: id,
    tabId: 1,
    videoId: "12345678901",
    settingsRevision: 1,
    phase: "complete" as const,
    startedAt: 1,
    deadlineAt: 100,
    requestCount: 1,
    completedLineIds: ["l0"],
  },
  output: ["result"],
  partial: ["result"],
});
it("bounds durable run count and does not duplicate completed output", async () => {
  const storage = store();
  const journal = new RunJournal(storage);
  await journal.persist(record("old"));
  await journal.persist(record("new"));
  expect(Object.keys(storage.entries)).toEqual(["run:new"]);
  expect(storage.entries["run:new"].partial).toBeUndefined();
  expect(storage.entries["run:new"].output).toEqual(["result"]);
});
it("oversized restart snapshots are explicit interruptions, not successful empty output", async () => {
  const storage = store(),
    journal = new RunJournal(storage);
  await journal.persist({ ...record("big"), output: "x".repeat(300000) });
  expect(storage.entries["run:big"].state.phase).toBe("interrupted");
  expect(JSON.stringify(storage.entries["run:big"]).length).toBeLessThan(
    262144,
  );
});
it("restores only the latest run and marks unfinished work interrupted", async () => {
  const storage = store(),
    journal = new RunJournal(storage);
  storage.entries["run:old"] = record("old");
  storage.entries["run:new"] = {
    ...record("new"),
    state: { ...record("new").state, startedAt: 2, phase: "aligning" },
  };
  await journal.restore();
  expect(Object.keys(storage.entries)).toEqual(["run:new"]);
  expect(storage.entries["run:new"].state.phase).toBe("interrupted");
});
it("does not retain an oversized acoustic snapshot after dropping other fields", async () => {
  const storage = store(),
    journal = new RunJournal(storage);
  await journal.persist({
    ...record("big"),
    acoustic: { lines: "x".repeat(300000) } as any,
  });
  expect(JSON.stringify(storage.entries["run:big"]).length).toBeLessThan(
    262144,
  );
  expect(storage.entries["run:big"].state.phase).toBe("interrupted");
});
