import { it, expect } from "vitest";
import "fake-indexeddb/auto";
import { WorkspaceStore } from "../../src/background/workspaces";
it("persists drafts, partial timing and search independently across store instances", async () => {
  const store = new WorkspaceStore();
  const initial = await store.open("12345678901");
  await store.patch("12345678901", initial.generation, {
    panel: {
      text: "lyrics",
      lines: [],
      mode: "original",
      offset: 0,
      onlyPending: false,
      runMode: "background",
      resumeView: "search",
      source: { kind: "paste" },
      editors: {
        web: { draft: '{"broken":', original: "{}", mode: "json", open: true },
      },
      activeRoute: "web",
    },
  });
  const reopened = await new WorkspaceStore().open("12345678901");
  expect(reopened.panel?.editors?.web?.draft).toBe('{"broken":');
  expect(reopened.panel?.text).toBe("lyrics");
  expect(reopened.generation).toBe(initial.generation);
  expect((await store.open("abcdefghijk")).panel).toBeUndefined();
});
it("reset rejects stale saves and search completions without deleting other videos", async () => {
  const store = new WorkspaceStore();
  const initial = await store.open("23456789012");
  await store.patch(initial.videoId, initial.generation, {
    video: {
      schemaVersion: 1,
      videoId: initial.videoId,
      title: "old",
      channel: "",
      description: "",
      durationMs: 1000,
    },
  });
  const reset = await store.reset(initial.videoId, initial.generation);
  await expect(
    store.patch(initial.videoId, initial.generation, {
      video: {
        schemaVersion: 1,
        videoId: initial.videoId,
        title: "late",
        channel: "",
        description: "",
        durationMs: 1000,
      },
    }),
  ).rejects.toThrow();
  expect((await store.open(initial.videoId)).generation).toBe(reset.generation);
  expect((await store.open(initial.videoId)).video).toBeUndefined();
});
it("merges independent tab edits without erasing another route draft", async () => {
  const store = new WorkspaceStore();
  const record = await store.open("34567890123");
  const panel: any = {
    text: "",
    lines: [],
    mode: "original",
    offset: 0,
    onlyPending: false,
    runMode: "background",
    resumeView: "search",
    source: { kind: "paste" },
    editors: {},
    activeRoute: "configured",
  };
  await store.savePanel(record.videoId, record.generation, panel);
  await store.savePanel(
    record.videoId,
    record.generation,
    {
      ...panel,
      editors: {
        configured: {
          draft: "changed A",
          original: "{}",
          mode: "json",
          open: true,
        },
      },
    },
    panel,
  );
  await store.savePanel(
    record.videoId,
    record.generation,
    {
      ...panel,
      editors: {
        web: { draft: "changed B", original: "{}", mode: "json", open: true },
      },
    },
    panel,
  );
  const result = await store.open(record.videoId);
  expect(result.panel?.editors.configured?.draft).toBe("changed A");
  expect(result.panel?.editors.web?.draft).toBe("changed B");
});
