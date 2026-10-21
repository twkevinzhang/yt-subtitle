import React, { useEffect, useRef, useState } from "react";
import type {
  AlignedLine,
  AlignmentMode,
  CaptionTrack,
  Cue,
  DisplayMode,
  LyricCandidate,
  PlayerBinding,
  PublicSettings,
  SavedResult,
  SubtitleLine,
  SubtitleSource,
  VideoContext,
} from "../shared/types";
import { request } from "../shared/messages";
import { hashInput } from "../background/results";
import type {
  SearchGroupSnapshot,
  SearchRoute,
} from "../background/search-group";
import type { AlignmentProgress } from "../acoustic/alignment-policy";
import { normalizeSubtitle } from "../lyrics/subtitle-source";
import { lockTiming } from "../lyrics/timing-locks";
import { validateTiming } from "../lyrics/formats";
import { toSrt, safeFilename } from "../lyrics/export";
import { manualTracks, selectManualTrack } from "../youtube/manual-tracks";
import type { createOverlay } from "../content/overlay";
import { useSubtitleWork } from "./use-subtitle-work";
import { TimingDiagnostics } from "./TimingDiagnostics";
import { SourceActions } from "./SourceActions";
import { SearchGroups } from "./SearchGroups";
import { Editor } from "./Editor";
import { LyricsPreview } from "./LyricsPreview";
import { ContentSkeleton } from "./Skeleton";
import { ReloadDialog } from "./ReloadDialog";
import type {
  VideoWorkspace,
  WorkspacePanel,
  RequestEditorState,
  AlignmentCheckpoint,
} from "../shared/workspace";
import { isUserAction } from "./user-action";
const modeNames: Record<AlignmentMode, string> = {
  "buffer-before-play": "先緩衝再播放",
  background: "播放中背景校時",
  "complete-before-use": "整首校完再使用",
};
const fallback = {
  mode: "original" as const,
  targetLanguage: "zh-Hant" as const,
  fontSize: 28,
  position: "bottom" as const,
  alignmentMode: "buffer-before-play" as const,
};
export function Panel({
  binding,
  overlay,
  onClose,
  publicSettings,
}: {
  binding: PlayerBinding;
  overlay: ReturnType<typeof createOverlay>;
  onClose: () => void;
  publicSettings?: PublicSettings;
}) {
  const [settings, setSettings] = useState(publicSettings),
    [video, setVideo] = useState<VideoContext>(),
    [tracks, setTracks] = useState<CaptionTrack[]>([]),
    [manualId, setManualId] = useState<string>();
  const [view, setView] = useState<
      "lyrics" | "paste" | "search" | "edit" | "saved"
    >("lyrics"),
    [text, setText] = useState(""),
    [lines, setLines] = useState<SubtitleLine[]>([]);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reading, setReading] = useState(false),
    [searching, setSearching] = useState(false),
    [search, setSearch] = useState<SearchGroupSnapshot>();
  const [saved, setSaved] = useState<SavedResult[]>([]),
    [mode, setMode] = useState<DisplayMode>(
      publicSettings?.preferences.mode ?? "original",
    ),
    [offset, setOffset] = useState(0),
    [position, setPosition] = useState(0),
    [onlyPending, setOnlyPending] = useState(false);
  const [runMode, setRunMode] = useState<AlignmentMode>(
    publicSettings?.preferences.alignmentMode ?? "buffer-before-play",
  );
  const live = useRef(true),
    searchId = useRef<string | undefined>(undefined),
    searchRevision = useRef(0),
    previewRun = useRef<string | undefined>(undefined),
    revision = useRef(0),
    source = useRef<SubtitleSource>({ kind: "paste" }),
    provenance = useRef<
      | {
          targetLanguage: "ja" | "zh-Hant" | "en";
          model: string;
          source: SavedResult["source"];
        }
      | undefined
    >(undefined);
  const [restored, setRestored] = useState(false),
    [storageError, setStorageError] = useState("");
  const [confirmReload, setConfirmReload] = useState(false),
    [reloading, setReloading] = useState(false);
  const [editors, setEditors] = useState<
    Partial<Record<SearchRoute, RequestEditorState>>
  >({});
  const [activeRoute, setActiveRoute] = useState<SearchRoute>("configured");
  const [checkpoint, setCheckpoint] = useState<AlignmentCheckpoint>();
  const generation = useRef(""),
    autosaveReady = useRef(false),
    lastSaved = useRef("");
  const resumeView = useRef<WorkspacePanel["resumeView"]>("search");
  const latestPanel = useRef<WorkspacePanel | undefined>(undefined);
  const resetting = useRef(false);
  const baselinePanel = useRef<WorkspacePanel | undefined>(undefined);
  const saveSequence = useRef(0);
  const dirtyFields = useRef(new Map<string, number>());
  const prefs = settings?.preferences ?? fallback;
  const onProgress = (p: AlignmentProgress) => {
    if (resetting.current) return;
    const alignment = {
      checked: p.checked,
      ready: p.ready,
      phase: p.phase,
      error: p.error,
    };
    setCheckpoint(alignment);
    if (latestPanel.current)
      savePanel({ ...latestPanel.current, lines: p.lines, alignment });
    setLines(p.lines);
    if (p.error) setNotice(p.error);
    if (p.phase !== "complete" && (p.mode ?? runMode) === "complete-before-use")
      return;
    if (!p.lines.some((l) => l.startMs !== undefined && l.endMs !== undefined))
      return;
    if (previewRun.current !== p.key.runId) {
      overlay.beginDraft(p.key);
      previewRun.current = p.key.runId;
    }
    overlay.setDraftPreview(
      {
        key: p.key,
        sequence: p.sequence,
        lines: p.lines,
        segments: {},
        modelState: p.phase === "loading" ? "loading" : "ready",
      },
      mode,
      prefs,
      offset,
    );
  };
  const work = useSubtitleWork(binding, onProgress, setNotice),
    busy = work.busy || reading || searching;
  const savePanel = (panel: WorkspacePanel) => {
    if (!autosaveReady.current || resetting.current || !generation.current)
      return;
    const encoded = JSON.stringify(panel);
    if (encoded === lastSaved.current) return;
    lastSaved.current = encoded;
    const baseline = baselinePanel.current;
    if (
      !baseline &&
      !panel.text.trim() &&
      !panel.lines.length &&
      !Object.keys(panel.editors).length
    ) {
      baselinePanel.current = structuredClone(panel);
      return;
    }
    const sequence = ++saveSequence.current;
    for (const key of new Set([
      ...Object.keys(panel),
      ...Object.keys(baseline ?? {}),
    ]) as Set<keyof WorkspacePanel>) {
      if (key === "editors") {
        for (const route of ["configured", "comments", "web"] as const)
          if (
            JSON.stringify(panel.editors[route]) !==
            JSON.stringify(baseline?.editors[route])
          )
            dirtyFields.current.set("editors." + route, sequence);
      } else if (JSON.stringify(panel[key]) !== JSON.stringify(baseline?.[key]))
        dirtyFields.current.set(key, sequence);
    }
    baselinePanel.current = structuredClone(panel);
    const sent = new Map(dirtyFields.current),
      expectedGeneration = generation.current;
    const fields = [
      ...new Set([...sent.keys()].map((key) => key.split(".")[0])),
    ];
    const editorRoutes = [...sent.keys()]
      .filter((key) => key.startsWith("editors."))
      .map((key) => key.slice(8) as SearchRoute);
    void request({
      type: "workspace-save",
      generation: expectedGeneration,
      panel,
      fields,
      editorRoutes,
    })
      .then(() => {
        if (generation.current !== expectedGeneration) return;
        for (const [key, version] of sent)
          if (dirtyFields.current.get(key) === version)
            dirtyFields.current.delete(key);
      })
      .catch((error) => {
        if (generation.current !== expectedGeneration) return;
        lastSaved.current = "";
        if (live.current)
          setStorageError(
            error instanceof Error ? error.message : String(error),
          );
      });
  };
  useEffect(() => {
    let current = true;
    autosaveReady.current = false;
    setRestored(false);
    void request<VideoWorkspace>({ type: "workspace-open" })
      .then((record) => {
        if (!current) return;
        if (!record?.generation)
          throw Error("無法讀取已儲存工作，為避免覆寫資料，請重新開啟面板");
        generation.current = record.generation;
        if (record.search) {
          setSearch(record.search);
          searchId.current = record.search.id;
        }
        const panel = record.panel;
        if (panel) {
          setText(panel.text);
          setLines(panel.lines);
          setMode(panel.mode);
          setOffset(panel.offset);
          setOnlyPending(panel.onlyPending);
          setRunMode(panel.runMode);
          setManualId(panel.manualId);
          source.current = panel.source;
          provenance.current = panel.provenance;
          resumeView.current = panel.resumeView;
          setEditors(panel.editors);
          setActiveRoute(panel.activeRoute);
          const interrupted =
            panel.alignment &&
            ["loading", "buffering", "running"].includes(panel.alignment.phase);
          setCheckpoint(
            interrupted
              ? { ...panel.alignment!, phase: "partial" }
              : panel.alignment,
          );
          setNotice(
            interrupted
              ? "已恢復上次工作；校時已中斷，已完成的部分保留，可接續補時。"
              : (panel.notice ?? ""),
          );
          setError(panel.error ?? "");
          lastSaved.current = JSON.stringify(panel);
          baselinePanel.current = structuredClone(panel);
        }
        autosaveReady.current = true;
        setRestored(true);
      })
      .catch((e) => {
        if (current)
          setStorageError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      current = false;
      autosaveReady.current = false;
    };
  }, [binding.videoId]);
  if (view !== "lyrics") resumeView.current = view;
  latestPanel.current = {
    text,
    lines,
    mode,
    offset,
    onlyPending,
    runMode,
    source: source.current,
    provenance: provenance.current,
    manualId,
    resumeView: resumeView.current,
    editors,
    activeRoute,
    alignment: checkpoint,
    notice,
    error,
  };
  useEffect(() => {
    if (restored && latestPanel.current) savePanel(latestPanel.current);
  }, [
    restored,
    text,
    lines,
    mode,
    offset,
    onlyPending,
    runMode,
    manualId,
    view,
    editors,
    activeRoute,
    checkpoint,
    notice,
    error,
  ]);
  useEffect(() => {
    const flush = () => {
      if (latestPanel.current) savePanel(latestPanel.current);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);
  const hasData =
    !!search ||
    lines.length > 0 ||
    !!text.trim() ||
    Object.keys(editors).length > 0;
  const attempt = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      if (live.current) setError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    if (publicSettings) setSettings(publicSettings);
  }, [publicSettings?.settingsRevision]);
  useEffect(() => {
    live.current = true;
    const refresh = () => {
      void request<PublicSettings>({ type: "settings-public" })
        .then((s) => {
          if (live.current && s) setSettings(s);
        })
        .catch(() => {});
    };
    if (!publicSettings) refresh();
    window.addEventListener("focus", refresh);
    void request<{
      video: VideoContext;
      tracks: CaptionTrack[];
      selectedTrackId?: string;
    }>({ type: "inspect" })
      .then((ctx) => {
        if (!live.current || ctx.video.videoId !== binding.videoId) return;
        setVideo(ctx.video);
        setTracks(ctx.tracks);
        setManualId(
          (previous) =>
            previous ??
            selectManualTrack(
              ctx.tracks,
              ctx.selectedTrackId,
              (publicSettings?.preferences ?? fallback).targetLanguage,
            )?.id,
        );
      })
      .catch((e) => {
        if (live.current) setError(e.message);
      });
    void request<SavedResult[]>({
      type: "results-list",
      videoId: binding.videoId,
    })
      .then((results) => {
        if (live.current) setSaved(results ?? []);
      })
      .catch(() => {});
    const timer = setInterval(
      () => setPosition(Math.max(0, binding.video.currentTime * 1000)),
      300,
    );
    return () => {
      live.current = false;
      searchRevision.current++;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      if (searchId.current)
        void request({ type: "search-cancel", id: searchId.current }).catch(
          () => {},
        );
    };
  }, [binding.videoId]);
  const preview = (
    draft: SubtitleLine[],
    displayMode = mode,
    previewOffset = offset,
  ) => {
    const key = {
      runId: crypto.randomUUID(),
      tabId: 0,
      videoId: binding.videoId,
      draftRevision: ++revision.current,
    };
    overlay.beginDraft(key);
    previewRun.current = key.runId;
    overlay.setDraftPreview(
      { key, sequence: 1, lines: draft, segments: {}, modelState: "unloaded" },
      displayMode,
      prefs,
      previewOffset,
    );
  };
  const adopt = async (
    draft: SubtitleLine[],
    origin: SubtitleSource,
    expectedGeneration = generation.current,
  ) => {
    if (!video) throw new Error("影片資訊尚未就緒");
    if (!draft.length) throw new Error("請先提供字幕");
    await work.cancel();
    if (
      !live.current ||
      resetting.current ||
      generation.current !== expectedGeneration
    )
      return;
    setCheckpoint(undefined);
    source.current = origin;
    setLines(draft);
    setMode(prefs.mode);
    setOffset(0);
    setOnlyPending(false);
    setView("edit");
    setError("");
    provenance.current = {
      source: origin.url
        ? { kind: "network", url: origin.url }
        : { kind: "user" },
      targetLanguage: prefs.targetLanguage,
      model: "local-wasm",
    };
    const selectedMode = prefs.alignmentMode ?? "buffer-before-play";
    setRunMode(selectedMode);
    if (
      draft.every(
        (l) => l.excluded || (l.startMs !== undefined && l.endMs !== undefined),
      )
    ) {
      preview(draft, prefs.mode, 0);
      setNotice("已保留來源時間碼，可直接使用、保存或下載。");
      return;
    }
    setNotice("字幕已保留，正在本機補齊缺少的時間…");
    await work.start(draft, selectedMode, video.durationMs);
  };
  const useYT = (trackId = manualId) =>
    attempt(async () => {
      if (!video || !trackId) return;
      const expectedGeneration = generation.current;
      setReading(true);
      try {
        const cues = await request<Cue[]>({
          type: "read-manual-track",
          trackId,
        });
        if (
          !live.current ||
          resetting.current ||
          generation.current !== expectedGeneration
        )
          return;
        const draft = cues.map((cue, i) =>
          lockTiming(
            {
              id: `yt-${i}`,
              original: cue.text,
              startMs: cue.startMs,
              endMs: cue.endMs,
              status: "anchor",
              excluded: false,
              cueIds: [cue.id],
            },
            video.durationMs,
          ),
        );
        setReading(false);
        await adopt(draft, { kind: "youtube", trackId }, expectedGeneration);
        setManualId(trackId);
      } finally {
        if (live.current && generation.current === expectedGeneration)
          setReading(false);
      }
    });
  const followSearch = async (id: string) => {
    const deadline = Date.now() + 125000;
    while (live.current && searchId.current === id) {
      if (Date.now() > deadline) throw new Error("搜尋工作已中斷，請重新搜尋");
      const snapshot = await request<SearchGroupSnapshot | undefined>({
        type: "search-group",
        id: id,
      });
      if (!live.current || searchId.current !== id) return;
      if (snapshot) {
        setSearch(snapshot);
        if (snapshot.storageError) setStorageError(snapshot.storageError);
        if (Object.values(snapshot.routes).every((r) => r.phase !== "pending"))
          break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };
  const continueWork = () =>
    void attempt(async () => {
      if (lines.length && resumeView.current !== "search") {
        setView("edit");
        preview(lines);
        return;
      }
      if (search) {
        setView("search");
        if (Object.values(search.routes).some((r) => r.phase === "pending")) {
          setSearching(true);
          try {
            await followSearch(search.id);
          } finally {
            if (live.current) setSearching(false);
          }
        }
        return;
      }
      setView(resumeView.current);
    });
  const startSearch = () =>
    attempt(async () => {
      if (!video || !settings?.configured) return;
      if (hasData && !resetting.current) {
        setView(lines.length ? "edit" : "search");
        return;
      }
      const expectedGeneration = generation.current;
      const ownRevision = ++searchRevision.current;
      setView("search");
      setSearch(undefined);
      setSearching(true);
      try {
        const payload = {
          video,
          sources: settings.sources.filter((s) => s.enabled),
        };
        const consent = {
          purpose: "search" as const,
          inputHash: await hashInput(payload),
          settingsRevision: settings.settingsRevision,
          confirmedAt: Date.now(),
        };
        const result = await request<{ id: string }>({
          type: "search-start",
          generation: expectedGeneration,
          video,
          consent,
        });
        if (!live.current || ownRevision !== searchRevision.current) {
          await request({ type: "search-cancel", id: result.id });
          return;
        }
        searchId.current = result.id;
        await followSearch(result.id);
      } finally {
        if (live.current && ownRevision === searchRevision.current)
          setSearching(false);
      }
    });
  const reload = () =>
    void attempt(async () => {
      if (!video || !generation.current || resetting.current) return;
      resetting.current = true;
      setReloading(true);
      searchRevision.current++;
      try {
        await work.cancel();

        const fresh = await request<VideoWorkspace>({
          type: "workspace-reset",
          generation: generation.current,
        });
        generation.current = fresh.generation;
        searchId.current = undefined;
        source.current = { kind: "paste" };
        provenance.current = undefined;
        previewRun.current = undefined;
        resumeView.current = "search";
        setReading(false);
        setSearching(false);
        setSearch(undefined);
        setText("");
        setLines([]);
        setEditors({});
        setActiveRoute("configured");
        setCheckpoint(undefined);
        setOffset(0);
        setOnlyPending(false);
        setNotice("");
        setError("");
        setStorageError("");
        setMode(prefs.mode);
        setRunMode(prefs.alignmentMode ?? "buffer-before-play");
        overlay.stop();
        lastSaved.current = "";
        baselinePanel.current = undefined;
        dirtyFields.current.clear();
        setConfirmReload(false);
        setView("search");
        // Defer one render so the new search sees only the new workspace state.
        if (settings?.configured) setReloadSearch(true);
        else {
          setView("lyrics");
          setNotice("已清除工作資料；設定 AI 服務後即可重新搜尋。");
        }
      } finally {
        resetting.current = false;
        setReloading(false);
      }
    });
  const [reloadSearch, setReloadSearch] = useState(false);
  useEffect(() => {
    if (reloadSearch) {
      setReloadSearch(false);
      void startSearch();
    }
  }, [reloadSearch]);
  const choose = (candidate: LyricCandidate, route: SearchRoute) =>
    void attempt(async () => {
      if (!video) return;
      const expectedGeneration = generation.current;
      searchRevision.current++;
      if (searchId.current) {
        const id = searchId.current;
        searchId.current = undefined;
        await request({ type: "search-cancel", id });
      }
      setSearching(false);
      await adopt(
        normalizeSubtitle(
          candidate.syncedLyrics || candidate.fullText || "",
          { kind: route, url: candidate.url },
          video.durationMs,
        ),
        { kind: route, url: candidate.url },
        expectedGeneration,
      );
    });
  const issues = video ? validateTiming(lines, video.durationMs, offset) : [],
    pendingIds = new Set(
      issues.filter((i) => i.severity === "error").map((i) => i.lineId),
    );
  const pending = lines.filter((l) => !l.excluded && pendingIds.has(l.id));
  const result = async (): Promise<SavedResult> => {
    if (!video || !lines.some((l) => !l.excluded))
      throw new Error("請先取得字幕");
    if (issues.some((i) => i.severity === "error"))
      throw new Error("請先校正或排除缺時及無效時間的句子");
    if (
      mode !== "original" &&
      lines.some((l) => !l.excluded && !l.translation?.trim())
    )
      throw new Error("部分譯文尚未生成");
    const actual = provenance.current ?? {
      source: { kind: "user" as const },
      targetLanguage: prefs.targetLanguage,
      model: "",
    };
    return {
      schemaVersion: 1,
      key: {
        schemaVersion: 1,
        videoId: video.videoId,
        inputHash: await hashInput({
          lines,
          source: actual.source,
          targetLanguage: actual.targetLanguage,
        }),
        targetLanguage: actual.targetLanguage,
      },
      videoDurationMs: video.durationMs,
      subtitleSource: source.current,
      source: actual.source,
      lines,
      offsetMs: offset,
      model: actual.model,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  };
  const save = () =>
    attempt(async () => {
      const value = await result();
      await request({ type: "results-save", result: value });
      overlay.setResult(value, mode, prefs);
      setSaved(
        (await request<SavedResult[]>({
          type: "results-list",
          videoId: binding.videoId,
        })) ?? [],
      );
      setNotice("已套用並保存至本機。");
    });
  const download = () =>
    attempt(async () => {
      const value = await result(),
        srt = toSrt(value.lines, mode, offset, value.videoDurationMs),
        url = URL.createObjectURL(
          new Blob([srt], { type: "text/plain;charset=utf-8" }),
        );
      const a = document.createElement("a");
      a.href = url;
      a.download = safeFilename(video!.title) + ".srt";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  return (
    <div
      className={`panel ${view === "edit" ? "review-panel" : ""}`}
      role="region"
      aria-label="AI 歌詞工作面板"
    >
      <header>
        <div className="row panel-title">
          {view !== "lyrics" && (
            <button
              className="back-button"
              aria-label="← 返回歌詞"
              title="返回歌詞"
              onClick={() => setView("lyrics")}
            >
              ←
            </button>
          )}
          <h2>AI 歌詞</h2>
        </div>
        <div className="row header-actions">
          <button
            disabled={!restored || reloading || !video}
            onClick={() => setConfirmReload(true)}
          >
            重新載入
          </button>
          <button onClick={() => void request({ type: "open-options" })}>
            設定
          </button>
          <button aria-label="關閉面板" onClick={onClose}>
            ×
          </button>
        </div>
      </header>
      {confirmReload && (
        <ReloadDialog
          busy={reloading}
          onCancel={() => setConfirmReload(false)}
          onConfirm={reload}
        />
      )}
      <div className="workspace">
        <section className="panel-body stack" aria-label="歌詞操作與設定">
          {!!storageError && (
            <p role="alert" className="error">
              {storageError}
            </p>
          )}
          {!restored && !storageError && (
            <p role="status">正在恢復本機工作資料…</p>
          )}
          {!!notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
          {!!error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {!video ? (
            <ContentSkeleton label="正在載入影片資訊" />
          ) : (
            <>
              <p className="muted">
                {lines.length ? `${lines.length} 句字幕` : "尚未加入字幕"}
              </p>
              <strong>{video.title}</strong>
              <small>
                {video.channel} · {Math.floor(video.durationMs / 60000)}:
                {String(Math.floor(video.durationMs / 1000) % 60).padStart(
                  2,
                  "0",
                )}
              </small>
            </>
          )}
          {
            <div hidden={view !== "lyrics"} className="stack">
              <SourceActions
                busy={busy || !video || !restored || hasData || reloading}
                configured={!!settings?.configured}
                hasManual={!!manualTracks(tracks).length}
                onAI={(event) => {
                  if (isUserAction(event)) void startSearch();
                }}
                onYT={() => void useYT()}
                onPaste={() => setView("paste")}
              />
              {hasData && (
                <>
                  <button
                    className="primary continue-work"
                    disabled={!restored || reloading}
                    onClick={continueWork}
                  >
                    繼續
                  </button>
                  <p className="muted">
                    已保留這支影片的工作資料。繼續先前工作，或使用標題列的重新載入清除重做。
                  </p>
                </>
              )}
              {!settings?.configured && (
                <p className="muted">
                  尚未設定 AI 服務；YT 字幕與貼入字幕仍可使用。
                </p>
              )}
              {!!lines.length && (
                <>
                  <LyricsPreview
                    lines={lines}
                    mode={mode}
                    video={binding.video}
                    seek={(ms) => {
                      binding.video.currentTime = ms / 1000;
                    }}
                    offsetMs={offset}
                  />
                  <button onClick={() => setView("edit")}>製作／編輯</button>
                </>
              )}
              <button onClick={() => setView("saved")}>
                本機版本（{saved.length}）
              </button>
            </div>
          }

          {view === "search" && (
            <>
              <h3>三路字幕搜尋</h3>
              {!!lines.length && (
                <button onClick={() => setView("edit")}>回到歌詞與校時</button>
              )}
              <SearchGroups
                key={search?.id ?? "loading"}
                snapshot={search}
                editorStates={editors}
                activeRoute={activeRoute}
                onActiveRoute={setActiveRoute}
                onEditorChange={(route, state) => {
                  const next = { ...editors, [route]: state };
                  setEditors(next);
                  if (latestPanel.current)
                    savePanel({ ...latestPanel.current, editors: next });
                }}
                onSelect={choose}
                onRetry={async (route, body) => {
                  if (!search) return;
                  const id = search.id;
                  const result = await request<
                    SearchGroupSnapshot["routes"][SearchRoute]
                  >({ type: "search-route-retry", id, route, body });
                  if (live.current)
                    setSearch((previous) =>
                      previous?.id === id
                        ? {
                            ...previous,
                            routes: { ...previous.routes, [route]: result },
                          }
                        : previous,
                    );
                }}
                onCancel={async (route) => {
                  if (search)
                    await request({
                      type: "search-route-cancel",
                      id: search.id,
                      route,
                    });
                }}
              />
              {searching && (
                <button
                  onClick={() =>
                    void attempt(async () => {
                      searchRevision.current++;
                      const id = searchId.current;
                      searchId.current = undefined;
                      if (id)
                        await request({
                          type: "search-cancel",
                          id,
                        });
                      searchId.current = undefined;
                      setSearching(false);
                    })
                  }
                >
                  取消搜尋
                </button>
              )}
            </>
          )}
          {view === "paste" && (
            <section className="section">
              <h3>貼入字幕</h3>
              <p>貼入純文字或含時間碼的 LRC／SRT 文字；有效時間碼會保留。</p>
              <textarea
                aria-label="字幕全文"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="每行一句字幕"
              />
              <button
                disabled={!video || busy}
                onClick={() =>
                  void attempt(async () => {
                    if (video)
                      await adopt(
                        normalizeSubtitle(
                          text,
                          { kind: "paste" },
                          video.durationMs,
                        ),
                        { kind: "paste" },
                      );
                  })
                }
              >
                使用貼入字幕
              </button>
            </section>
          )}
          {view === "edit" && (
            <>
              <div className="row">
                <button
                  disabled={busy || hasData}
                  onClick={(event) => {
                    if (isUserAction(event)) void startSearch();
                  }}
                >
                  AI 找字幕
                </button>
                <button
                  disabled={busy || hasData || !manualTracks(tracks).length}
                  onClick={() => void useYT()}
                >
                  YT 字幕
                </button>
                <button
                  disabled={busy || hasData}
                  onClick={() => setView("paste")}
                >
                  貼入字幕
                </button>
              </div>
              {!!manualTracks(tracks).length && (
                <label>
                  人工 YT 字幕軌
                  <select
                    aria-label="人工 YT 字幕軌"
                    value={manualId ?? ""}
                    disabled={busy || hasData}
                    onChange={(event) => void useYT(event.target.value)}
                  >
                    {manualTracks(tracks).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label || t.language}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {search && (
                <button onClick={() => setView("search")}>
                  查看搜尋結果與請求
                </button>
              )}
              {checkpoint && !work.busy && (
                <p className="muted">
                  已保留校時進度：已檢查 {checkpoint.checked.length} 個音訊區段
                  {pending.length ? "，可接續補時。" : "。"}
                </p>
              )}
              <label>
                本次校時模式
                <select
                  aria-label="本次校時模式"
                  value={runMode}
                  disabled={reading || searching}
                  onChange={(event) => {
                    const next = event.target.value as AlignmentMode;
                    void attempt(async () => {
                      await work.cancel();
                      setRunMode(next);
                      if (video)
                        await work.start(lines, next, video.durationMs);
                    });
                  }}
                >
                  {Object.entries(modeNames).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                本次切換不會變更設定頁的預設模式。有效時間碼保留，只補缺時部分。
              </p>
              {work.busy && (
                <>
                  <p role="status">
                    {modeNames[runMode]}：
                    {work.progress?.phase === "loading"
                      ? "模型載入中"
                      : `${work.progress?.phase === "buffering" ? "取得正片音訊中" : "本機辨識與校時中"}，已檢查 ${work.progress?.checked.length ?? 0} 個音訊區段`}
                  </p>
                  <button onClick={() => void attempt(() => work.cancel())}>
                    取消補時
                  </button>
                </>
              )}
              <p>
                已校時{" "}
                {
                  lines.filter(
                    (l) =>
                      !l.excluded &&
                      l.startMs !== undefined &&
                      l.endMs !== undefined,
                  ).length
                }
                ／{lines.filter((l) => !l.excluded).length} 句
              </p>
              <p>待處理 {pending.length} 句</p>
              {work.diagnostics?.videoId === binding.videoId && (
                <TimingDiagnostics report={work.diagnostics} />
              )}
              <label>
                <input
                  type="checkbox"
                  checked={onlyPending}
                  onChange={(event) => setOnlyPending(event.target.checked)}
                />
                只看待處理
              </label>
              <Editor
                lines={
                  onlyPending
                    ? lines.filter((l) => pendingIds.has(l.id))
                    : lines
                }
                disabled={work.busy}
                onChange={(updated) => {
                  if (!video) return;
                  const map = new Map(updated.map((l) => [l.id, l]));
                  setLines(
                    lines.map((l) =>
                      lockTiming(map.get(l.id) ?? l, video.durationMs),
                    ),
                  );
                }}
                currentMs={() => binding.video.currentTime * 1000}
                seek={(ms) => {
                  binding.video.currentTime = ms / 1000;
                }}
              />
              <label>
                顯示方式
                <select
                  aria-label="顯示方式"
                  value={mode}
                  onChange={(event) =>
                    setMode(event.target.value as DisplayMode)
                  }
                >
                  <option value="original">原文</option>
                  <option value="bilingual">雙語</option>
                  <option value="translation">僅譯文</option>
                </select>
              </label>
              <label>
                整體偏移（秒）
                <input
                  aria-label="整體偏移（秒）"
                  type="number"
                  step="0.1"
                  value={offset / 1000}
                  onChange={(event) =>
                    setOffset(Number(event.target.value) * 1000)
                  }
                />
              </label>
              {issues.some((i) => i.severity === "warning") && (
                <p className="muted">
                  部分字幕時間重疊，請聆聽確認；來源時間不會自動更改。
                </p>
              )}
              <div className="row">
                <button
                  disabled={busy || !!pending.length}
                  onClick={() => void save()}
                >
                  套用並保存
                </button>
                <button
                  disabled={busy || !!pending.length}
                  onClick={() => void download()}
                >
                  下載 SRT
                </button>
                <button
                  disabled={busy || !pending.length}
                  onClick={() =>
                    void attempt(async () => {
                      if (video)
                        await work.start(
                          lines,
                          runMode,
                          video.durationMs,
                          checkpoint,
                        );
                    })
                  }
                >
                  {checkpoint ? "接續補時" : "重新補時"}
                </button>
              </div>
            </>
          )}
          {view === "saved" && (
            <section>
              <h3>本機版本</h3>
              {!saved.length && <p>尚無保存版本</p>}
              {saved.map((value) => (
                <article key={value.key.inputHash}>
                  <p>
                    {value.lines.length} 句／{value.key.targetLanguage}
                  </p>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (!video) return;
                      const draft = value.lines.map((l) =>
                        lockTiming(l, video.durationMs),
                      );
                      setCheckpoint(undefined);
                      setLines(draft);
                      setOffset(value.offsetMs);
                      source.current = value.subtitleSource ?? {
                        kind: "legacy",
                      };
                      provenance.current = {
                        source: value.source,
                        targetLanguage: value.key.targetLanguage,
                        model: value.model,
                      };
                      const loadedMode =
                        mode !== "original" &&
                        value.lines.some(
                          (l) => !l.excluded && !l.translation?.trim(),
                        )
                          ? "original"
                          : mode;
                      if (loadedMode !== mode)
                        setNotice("此版本譯文不完整，已先以原文顯示。");
                      setMode(loadedMode);
                      overlay.setResult(value, loadedMode, prefs);
                      setView("edit");
                    }}
                  >
                    載入這份版本
                  </button>
                </article>
              ))}
            </section>
          )}
        </section>
      </div>
    </div>
  );
}
