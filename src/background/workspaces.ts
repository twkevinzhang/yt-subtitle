import { z } from "zod";
import {
  lineSchema,
  subtitleSourceSchema,
  videoSchema,
} from "../shared/schemas";
import type {
  VideoWorkspace,
  WorkspacePatch,
  WorkspacePanel,
} from "../shared/workspace";
const range = z.object({
  startMs: z.number().finite().nonnegative(),
  endMs: z.number().finite().nonnegative(),
});
const editor = z.object({
  draft: z.string(),
  original: z.string(),
  mode: z.enum(["form", "json"]),
  open: z.boolean(),
});
export const workspacePanelSchema = z.object({
  text: z.string(),
  lines: z.array(lineSchema).max(10000),
  mode: z.enum(["original", "bilingual", "translation"]),
  offset: z.number().finite(),
  onlyPending: z.boolean(),
  runMode: z.enum(["buffer-before-play", "background", "complete-before-use"]),
  resumeView: z.enum(["search", "edit", "paste", "saved"]),
  source: subtitleSourceSchema,
  manualId: z.string().optional(),
  provenance: z
    .object({
      targetLanguage: z.enum(["ja", "zh-Hant", "en"]),
      model: z.string(),
      source: z.object({
        kind: z.enum(["network", "user"]),
        url: z.string().optional(),
        version: z.string().optional(),
      }),
    })
    .optional(),
  editors: z.object({
    configured: editor.optional(),
    comments: editor.optional(),
    web: editor.optional(),
  }),
  activeRoute: z.enum(["configured", "comments", "web"]),
  alignment: z
    .object({
      checked: z.array(range),
      ready: z.array(range),
      phase: z.enum([
        "loading",
        "buffering",
        "running",
        "complete",
        "partial",
        "failed",
        "cancelled",
      ]),
      error: z.string().optional(),
    })
    .optional(),
  notice: z.string().optional(),
  error: z.string().optional(),
});
function connect(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ai-lyrics-workspaces", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("workspaces", { keyPath: "videoId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(Error("無法開啟工作資料庫；已有資料未清除"));
  });
}
export class WorkspaceStore {
  private async change(
    videoId: string,
    mutate: (current: VideoWorkspace | undefined) => VideoWorkspace,
  ): Promise<VideoWorkspace> {
    if (!/^[\w-]{11}$/.test(videoId)) throw Error("影片 ID 不正確");
    const db = await connect();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("workspaces", "readwrite"),
        store = tx.objectStore("workspaces");
      let result: VideoWorkspace;
      let error: unknown;
      const get = store.get(videoId);
      get.onsuccess = () => {
        try {
          result = mutate(get.result);
          store.put(result);
        } catch (e) {
          error = e;
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onabort = tx.onerror = () => {
        db.close();
        reject(error ?? Error("工作資料儲存失敗；請先保留面板並釋放磁碟空間"));
      };
    });
  }
  async open(videoId: string) {
    return this.change(
      videoId,
      (current) =>
        current ?? {
          schemaVersion: 1,
          videoId,
          generation: crypto.randomUUID(),
          updatedAt: Date.now(),
        },
    );
  }
  async patch(videoId: string, generation: string, patch: WorkspacePatch) {
    const validated = {
      ...patch,
      ...(patch.panel
        ? { panel: workspacePanelSchema.parse(patch.panel) as WorkspacePanel }
        : {}),
      ...(patch.video ? { video: videoSchema.parse(patch.video) } : {}),
    };
    return this.change(videoId, (current) => {
      if (!current || current.generation !== generation)
        throw Error("工作資料已重新載入，請重新開啟面板以讀取最新資料");
      return { ...current, ...validated, updatedAt: Date.now() };
    });
  }
  async savePanel(
    videoId: string,
    generation: string,
    panel: WorkspacePanel,
    baseline?: WorkspacePanel,
    selection?: {
      fields?: (keyof WorkspacePanel)[];
      editorRoutes?: import("./search-group").SearchRoute[];
    },
  ) {
    const incoming = workspacePanelSchema.parse(panel) as WorkspacePanel;
    return this.change(videoId, (current) => {
      if (!current || current.generation !== generation)
        throw Error("工作資料已重新載入，請重新開啟面板以讀取最新資料");
      const merged = { ...(current.panel ?? incoming) };
      for (const key of new Set(
        selection?.fields ?? [
          ...Object.keys(incoming),
          ...Object.keys(baseline ?? {}),
        ],
      ) as Set<keyof WorkspacePanel>) {
        if (!(key in workspacePanelSchema.shape)) continue;
        if (
          !selection?.fields &&
          baseline &&
          JSON.stringify(incoming[key]) === JSON.stringify(baseline[key])
        )
          continue;
        if (key === "editors") {
          merged.editors = { ...merged.editors };
          for (const route of selection?.editorRoutes ??
            (["configured", "comments", "web"] as const))
            if (
              selection?.fields ||
              !baseline ||
              JSON.stringify(incoming.editors[route]) !==
                JSON.stringify(baseline.editors[route])
            )
              merged.editors[route] = incoming.editors[route];
        } else Object.assign(merged, { [key]: incoming[key] });
      }
      return { ...current, panel: merged, updatedAt: Date.now() };
    });
  }
  async reset(videoId: string, generation: string) {
    return this.change(videoId, (current) => {
      if (!current || current.generation !== generation)
        throw Error("工作資料已改變，請重新開啟面板確認");
      return {
        schemaVersion: 1,
        reset: true,
        videoId,
        generation: crypto.randomUUID(),
        updatedAt: Date.now(),
      };
    });
  }
}
export const workspaces = new WorkspaceStore();
export function interruptedSearch(
  snapshot: import("./search-group").SearchGroupSnapshot,
) {
  const copy = structuredClone(snapshot);
  for (const result of Object.values(copy.routes))
    if (result.phase === "pending") {
      result.phase = "cancelled";
      result.error = "上次搜尋已中斷，已保留完成結果；可手動重新發送此來源";
    }
  return copy;
}
