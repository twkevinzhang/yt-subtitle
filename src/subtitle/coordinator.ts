import type { VideoContext } from "../shared/types";
import type { SearchGroupSnapshot } from "../background/search-group";
import type { SearchRoute } from "../background/search-group";
import type { PlayableCue, SelectedSource } from "./types";
import { initialJob, type JobSnapshot } from "./job-state";
import { validateSource } from "./result-validation";
import { resolveLibrary } from "./library-loader";
export interface VideoWork {
  entryMode?: "ai" | "paste";
  version: 2;
  video: VideoContext;
  settingsRevision: number;
  search?: SearchGroupSnapshot;
  job: JobSnapshot;
  source?: SelectedSource;
  publishedSource?: SelectedSource;
  cues?: readonly PlayableCue[];
  publishedSequence?: number;
  storageError?: string;
}
interface WorkDependencies {
  search: (
    tabId: number,
    video: VideoContext,
    signal: AbortSignal,
    update: (search: SearchGroupSnapshot) => void,
  ) => Promise<unknown>;
  save: (tabId: number, work: VideoWork) => Promise<void>;
  retrySearch?: (
    tabId: number,
    video: VideoContext,
    route: SearchRoute,
    previous: SearchGroupSnapshot,
    signal: AbortSignal,
    update: (search: SearchGroupSnapshot) => void,
  ) => Promise<unknown>;
}
export class SubtitleCoordinator {
  private works = new Map<number, VideoWork>();
  private controllers = new Map<number, AbortController>();
  private writes = new Map<number, Promise<void>>();
  constructor(private deps: WorkDependencies) {}
  restore(tabId: number, saved: VideoWork) {
    if (saved.version !== 2 || saved.job.key.tabId !== tabId) return;
    const work = structuredClone(saved);
    if (work.publishedSource) {
      const validation = validateSource(
        work.publishedSource,
        work.video.durationMs / 1000,
      );
      work.cues = validation.kind === "complete" ? validation.cues : undefined;
    } else work.cues = undefined;
    if (work.search)
      for (const route of Object.values(work.search.routes))
        if (route.phase === "pending") {
          route.phase = "failed";
          route.error = "搜尋因擴充功能重新啟動而中斷，請重新載入重試。";
        }
    if (
      !["complete", "failed", "incomplete", "selecting"].includes(
        work.job.phase,
      )
    ) {
      work.job.phase = "failed";
      work.job.error = {
        code: "INTERRUPTED",
        message: "工作因擴充功能重新啟動而中斷；請重試或更換來源。",
      };
    }
    this.works.set(tabId, work);
  }
  get(tabId: number, videoId: string) {
    const work = this.works.get(tabId);
    return work?.video.videoId === videoId ? structuredClone(work) : undefined;
  }
  private async persist(tabId: number, work: VideoWork) {
    const copy = structuredClone(work);
    const write = (this.writes.get(tabId) ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.deps.save(tabId, copy));
    this.writes.set(tabId, write);
    try {
      await write;
      work.storageError = undefined;
    } catch (error) {
      work.storageError =
        "工作資料未能儲存：" +
        (error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  async ensure(
    tabId: number,
    video: VideoContext,
    settingsRevision: number,
    discover = true,
  ): Promise<VideoWork> {
    const existing = this.works.get(tabId);
    if (
      existing?.video.videoId === video.videoId &&
      existing.settingsRevision === settingsRevision
    )
      return structuredClone(existing);
    this.cancel(tabId);
    const controller = new AbortController();
    this.controllers.set(tabId, controller);
    const work: VideoWork = {
      version: 2,
      entryMode: discover ? "ai" : "paste",
      video,
      settingsRevision,
      job: {
        ...initialJob({
          tabId,
          videoId: video.videoId,
          sourceFingerprint: "",
          generation: Date.now(),
        }),
        phase: discover ? "searching" : "selecting",
      },
    };
    this.works.set(tabId, work);
    if (!discover) {
      await this.persist(tabId, work);
      return structuredClone(work);
    }
    void this.deps
      .search(tabId, video, controller.signal, (search) => {
        if (this.works.get(tabId) !== work || controller.signal.aborted) return;
        work.search = search;
        if (
          ["searching", "selecting"].includes(work.job.phase) &&
          (Object.values(search.routes).some(
            (route) => route.candidates.length,
          ) ||
            Object.values(search.routes).every(
              (route) => route.phase !== "pending",
            ))
        )
          work.job.phase = "selecting";
        work.job.sequence++;
        void this.persist(tabId, work).catch(() => {});
      })
      .catch((error) => {
        if (this.works.get(tabId) !== work || controller.signal.aborted) return;
        work.job = {
          ...work.job,
          phase: "failed",
          failedPhase: "searching",
          sequence: work.job.sequence + 1,
          error: {
            code: "SEARCH_FAILED",
            message: error instanceof Error ? error.message : "搜尋失敗",
          },
        };
        void this.persist(tabId, work).catch(() => {});
      });
    await this.persist(tabId, work);
    return structuredClone(work);
  }
  async select(
    tabId: number,
    videoId: string,
    source: SelectedSource,
  ): Promise<VideoWork> {
    const work = this.works.get(tabId);
    if (!work || work.video.videoId !== videoId)
      throw Error("影片工作已切換，請重新開啟");
    const key = {
      ...work.job.key,
      sourceFingerprint: crypto.randomUUID(),
      generation: work.job.key.generation + 1,
    };
    work.source = structuredClone(source);
    work.job = {
      ...initialJob(key),
      sequence: work.job.sequence + 1,
      phase: "validating",
      timed: source.timings !== undefined,
    };
    const validation = validateSource(source, work.video.durationMs / 1000);
    if (validation.kind === "complete") {
      work.cues = validation.cues;
      work.publishedSource = structuredClone(source);
      work.job.phase = "complete";
      work.publishedSequence = work.job.sequence;
    } else if (validation.kind === "untimed") {
      const binding = await resolveLibrary();
      if (this.works.get(tabId) !== work || work.job.key !== key)
        return this.get(tabId, videoId)!;
      // No inferred package or hidden-player fallback. A real binding activates the host boundary.
      work.job.phase = "failed";
      work.job.failedPhase = binding ? "acquiring-audio" : "selecting";
      work.job.error = {
        code: binding ? "AUDIO_UNAVAILABLE" : "LIBRARY_UNAVAILABLE",
        message: binding
          ? "尚未接入獨立的整首音訊下載來源。"
          : "尚未接入符合契約的 lyric-align-ts，無時間碼歌詞暫時無法對齊。請更換含完整時間碼的字幕。",
      };
    } else {
      work.job.phase = "failed";
      work.job.failedPhase = "validating";
      work.job.error = {
        code: validation.kind === "invalid" ? validation.code : "UNMATCHED",
        message: "字幕時間碼不完整或格式無效；原文已保留，請更換來源。",
      };
    }
    if (this.works.get(tabId) !== work || work.job.key !== key)
      return this.get(tabId, videoId)!;
    await this.persist(tabId, work);
    return structuredClone(work);
  }
  cancel(tabId: number) {
    this.controllers.get(tabId)?.abort();
    this.controllers.delete(tabId);
    const work = this.works.get(tabId);
    if (work && work.job.phase !== "complete" && work.job.phase !== "failed") {
      work.job.phase = "cancelled";
      work.job.key = {
        ...work.job.key,
        generation: work.job.key.generation + 1,
      };
      work.job.sequence++;
      void this.persist(tabId, work).catch(() => {});
    }
  }
  reset(tabId: number) {
    this.cancel(tabId);
    this.works.delete(tabId);
  }
  resetAll() {
    for (const tabId of this.works.keys()) this.reset(tabId);
  }
  async retrySearch(tabId: number, videoId: string, route: SearchRoute) {
    const work = this.works.get(tabId);
    if (work?.entryMode === "paste") throw Error("貼入字幕模式不執行 AI 搜尋");
    if (
      !work?.search ||
      work.video.videoId !== videoId ||
      !this.deps.retrySearch
    )
      throw Error("搜尋工作不可用");
    if (work.search.routes[route].phase === "pending")
      throw Error("此來源仍在搜尋");
    let controller = this.controllers.get(tabId);
    if (!controller || controller.signal.aborted) {
      controller = new AbortController();
      this.controllers.set(tabId, controller);
    }
    const previous = structuredClone(work.search);
    work.search.routes[route].phase = "pending";
    await this.persist(tabId, work);
    await this.deps.retrySearch(
      tabId,
      work.video,
      route,
      previous,
      controller.signal,
      (search) => {
        if (this.works.get(tabId) !== work || controller.signal.aborted) return;
        work.search!.routes[route] = search.routes[route];
        work.job.sequence++;
        void this.persist(tabId, work).catch(() => {});
      },
    );
    return this.get(tabId, videoId);
  }
  async setEntryMode(tabId: number, videoId: string, mode: "ai" | "paste") {
    const work = this.works.get(tabId);
    if (!work || work.video.videoId !== videoId)
      throw Error("影片工作不存在，請先重新讀取");
    work.entryMode = mode;
    if (mode === "paste") {
      this.controllers.get(tabId)?.abort();
      this.controllers.delete(tabId);
      if (work.search)
        for (const route of Object.values(work.search.routes))
          if (route.phase === "pending") {
            route.phase = "cancelled";
            route.error =
              "已切換至貼入字幕，搜尋已取消；可返回 AI 取得字幕後重試。";
          }
      if (work.job.phase === "searching") work.job.phase = "selecting";
    }
    work.job.sequence++;
    await this.persist(tabId, work);
    return this.get(tabId, videoId)!;
  }
}
