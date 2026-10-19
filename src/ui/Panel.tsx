import React, { useEffect, useRef, useState } from "react";
import type {
  AlignedLine,
  CaptionTrack,
  Cue,
  LyricCandidate,
  PlayerBinding,
  PublicSettings,
  RunState,
  LyricSearchResult,
  SavedResult,
  VideoContext,
} from "../shared/types";
import { request } from "../shared/messages";
import { hashInput } from "../background/results";
import { parseLyrics, validateTiming } from "../lyrics/formats";
import { toSrt, safeFilename } from "../lyrics/export";
import { alignmentRequest } from "../lyrics/alignment-request";
import { alignmentBodySchema } from "../shared/schemas";
import { Candidates } from "./Candidates";
import { Editor } from "./Editor";
import { LyricsPreview } from "./LyricsPreview";
import { ContentSkeleton } from "./Skeleton";
import { AiReply } from "./AiReply";
import type { createOverlay } from "../content/overlay";
import type { RunRecord } from "../background/runs";
import {
  candidateDraft,
  provenanceOf,
  type DraftProvenance,
} from "../lyrics/draft";
import { isUserAction } from "./user-action";
import { startOwnedRun } from "./owned-run";
import { acousticEnabled, type JobKey } from "../acoustic/contracts";
import { acquireYouTubeAudio } from "../acoustic/youtube-audio-source";
import { regionRequest } from "../lyrics/region-request";
// YouTube may canonicalize the URL after initial loading.
const localAcoustic = acousticEnabled(location.href);
class WorkCancelled extends Error {}
type PendingWork = {
  cancelled: boolean;
  cancellation?: Promise<void>;
  controller?: AbortController;
};
type LeaveAction = "return" | "stop" | "close";
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
  const [settings, setSettings] = useState<PublicSettings | undefined>(
      publicSettings,
    ),
    [video, setVideo] = useState<VideoContext>(),
    [cues, setCues] = useState<Cue[]>([]);
  const [view, setView] = useState<
    "lyrics" | "search" | "paste" | "import" | "edit" | "saved"
  >("lyrics");
  const [reviewTab, setReviewTab] = useState<"result" | "request" | "response">(
    "result",
  );
  const [onlyPending, setOnlyPending] = useState(false);
  const [leaveAction, setLeaveAction] = useState<LeaveAction | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState("");
  const workRef = useRef<PendingWork | undefined>(undefined);
  const previewKey = useRef<JobKey | undefined>(undefined);
  const leaveTrigger = useRef<HTMLElement | null>(null);
  const editPage = useRef<HTMLElement>(null);
  const lyricsPage = useRef<HTMLElement>(null);
  const previousView = useRef(view);
  useEffect(() => {
    if (previousView.current !== view) {
      (view !== "lyrics" ? editPage : lyricsPage).current?.focus({
        preventScroll: true,
      });
      previousView.current = view;
    }
  }, [view]);
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [alignmentReport, setAlignmentReport] = useState("");
  const [message, setMessage] = useState("正在檢查播放器…"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [candidates, setCandidates] = useState<LyricCandidate[] | null>(null),
    [searchReply, setSearchReply] = useState<string | null>(null),
    [selected, setSelected] = useState<LyricCandidate>(),
    [text, setText] = useState(""),
    [lines, setLines] = useState<AlignedLine[]>([]),
    [offset, setOffset] = useState(0),
    [saved, setSaved] = useState<SavedResult[]>([]),
    [progress, setProgress] = useState("");
  const [requestBody, setRequestBody] = useState("");
  const [responseText, setResponseText] = useState("");
  const [imported, setImported] = useState<{
    name: string;
    lines: AlignedLine[];
  }>();
  const [appliedOffset, setAppliedOffset] = useState(0);
  const [appliedLines, setAppliedLines] = useState<AlignedLine[]>([]);
  const alignmentInput = useRef<AlignedLine[]>([]);
  const invalidIds = new Set(
    video
      ? validateTiming(lines, video.durationMs, offset)
          .filter((issue) => issue.severity === "error")
          .map((issue) => issue.lineId)
      : [],
  );
  const pending = lines.filter(
    (line) =>
      !line.excluded &&
      (invalidIds.has(line.id) ||
        line.startMs === undefined ||
        line.endMs === undefined),
  );
  const stamp = (ms: number | undefined) =>
    ms === undefined
      ? "待校時"
      : `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  const live = useRef(true),
    activeRun = useRef<string | undefined>(undefined);
  const provenance = useRef<DraftProvenance | undefined>(undefined);
  useEffect(() => {
    if (publicSettings) {
      setSettings(publicSettings);
    }
  }, [publicSettings?.settingsRevision, publicSettings?.configured]);
  useEffect(() => {
    const refresh = () => {
      void request<PublicSettings>({ type: "settings-public" })
        .then((s) => {
          if (live.current) {
            setSettings(s);
          }
        })
        .catch(() => {});
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  useEffect(() => {
    live.current = true;
    // These reads are independent: a slow cache or caption endpoint must not
    // hold up video metadata or local import controls.
    void (
      publicSettings
        ? Promise.resolve(publicSettings)
        : request<PublicSettings>({ type: "settings-public" })
    )
      .then((s) => {
        if (live.current) {
          setSettings(s);
        }
      })
      .catch(() => {});
    void request<SavedResult[]>({
      type: "results-list",
      videoId: binding.videoId,
    })
      .then((local) => {
        if (live.current) setSaved(local);
      })
      .catch(() => {});
    void (async () => {
      try {
        const ctx = await request<{
          video: VideoContext;
          tracks: CaptionTrack[];
        }>({ type: "inspect" });
        if (!live.current || ctx.video.videoId !== binding.videoId) return;
        setVideo(ctx.video);
        setMetadataLoading(false);
        const track = ctx.tracks.find((t) => !t.isTranslated);
        setMessage(
          track
            ? "已發現字幕軌，正在讀取內容…"
            : "尚未發現字幕軌，可嘗試讀取 YouTube 轉錄稿取得對齊時間。",
        );
        if (track) {
          try {
            const c = await request<Cue[]>({
              type: "read-track",
              trackId: track.id,
            });
            if (live.current) {
              setCues(c);
              setMessage(
                `已讀取 ${c.length} 段${c.some((cue) => cue.endEstimated) ? "YouTube 轉錄稿（句尾為估算）" : "字幕"}，可用來對齊歌詞`,
              );
            }
          } catch {
            if (live.current)
              setMessage(
                "自動字幕與轉錄稿讀取未完成。請按「讀取 YouTube 轉錄稿」恢復 AI 對齊，不需要逐句輸入時間。",
              );
          }
        }
      } catch (e) {
        if (live.current) {
          setError((e as Error).message);
          setVideo({
            schemaVersion: 1,
            videoId: binding.videoId,
            title: document.title,
            channel: "",
            description: "",
            durationMs: Math.round(binding.video.duration * 1000) || 0,
          });
          setMetadataLoading(false);
        }
      }
    })();
    return () => {
      live.current = false;
      workRef.current?.controller?.abort();
      void request({ type: "audio-clear" }).catch(() => {});
      if (activeRun.current)
        void request({ type: "cancel", runId: activeRun.current }).catch(
          () => {},
        );
    };
  }, []);
  const attempt = async (fn: () => Promise<void>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      if (live.current && !(e instanceof WorkCancelled))
        setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (!leaveAction && leaveTrigger.current) {
      leaveTrigger.current.focus();
      leaveTrigger.current = null;
    }
  }, [leaveAction]);
  const checkWork = async (work: PendingWork) => {
    // Wait for cancellation acknowledgement before accepting a concurrent response.
    await work.cancellation?.catch(() => {});
    if (work.cancelled) throw new WorkCancelled();
  };
  const leave = (action: LeaveAction) => {
    if (action === "return") setView("lyrics");
    else if (action === "close") onClose();
  };
  const requestLeave = (action: LeaveAction) => {
    if (!busy) {
      leave(action);
      return;
    }
    const root = editPage.current?.getRootNode() as
      Document | ShadowRoot | undefined;
    leaveTrigger.current = (root?.activeElement ||
      document.activeElement) as HTMLElement;
    setStopError("");
    setLeaveAction(action);
  };
  const continueWaiting = () => {
    setLeaveAction(null);
  };
  const confirmStop = async () => {
    if (!leaveAction || stopping) return;
    const action = leaveAction,
      work = workRef.current;
    setStopping(true);
    setStopError("");
    try {
      if (work) {
        const runId = activeRun.current;
        work.cancellation = (async () => {
          if (runId) await request({ type: "cancel", runId });
          work.controller?.abort();
          work.cancelled = true;
        })();
        await work.cancellation;
        if (workRef.current === work) activeRun.current = undefined;
      }
      if (!live.current) return;
      setBusy(false);
      setProgress("");
      setMessage("工作已取消，歌詞與已有結果已保留。");
      leaveTrigger.current = null;
      setLeaveAction(null);
      leave(action);
    } catch (error) {
      if (live.current)
        setStopError(
          `無法確認取消：${(error as Error).message}。請重試或繼續等待。`,
        );
    } finally {
      if (live.current) setStopping(false);
    }
  };
  const poll = async (state: RunState, work: PendingWork): Promise<unknown> => {
    if (!live.current) {
      await request({ type: "cancel", runId: state.runId });
      throw new Error("已離開影片，工作已取消");
    }
    await checkWork(work);
    activeRun.current = state.runId;
    setBusy(true);
    try {
      while (live.current) {
        const record = await request<RunRecord | null>({
          type: "run",
          runId: state.runId,
        });
        if (!live.current) {
          await request({ type: "cancel", runId: state.runId });
          throw new Error("已離開影片，工作已取消");
        }
        await checkWork(work);
        if (!record) throw new Error("工作已中斷，請重新開始");
        if (record.responseText !== undefined)
          setResponseText(record.responseText);
        if (record.alignmentReport) setAlignmentReport(record.alignmentReport);
        if (localAcoustic)
          void request({
            type: "acoustic-position",
            runId: state.runId,
            timeMs: Math.max(0, binding.video.currentTime * 1000),
          }).catch(() => {});
        if (record.acoustic && settings) {
          if (previewKey.current?.runId !== record.acoustic.key.runId) {
            overlay.beginDraft(record.acoustic.key);
            previewKey.current = record.acoustic.key;
          }
          setLines(record.acoustic.lines);
          setAppliedLines(record.acoustic.lines);
          setAppliedOffset(0);
          overlay.setDraftPreview(
            record.acoustic,
            "original",
            settings.preferences,
          );
        }
        setProgress(
          record.acoustic
            ? `本機聲學校時：已完成 ${record.state.completedLineIds.length} 句；模型 ${record.acoustic.modelState}。已完成片段可播放。`
            : `AI 區間定位中；已送出 ${record.state.requestCount} 次請求`,
        );
        if (record.state.phase === "complete") return record.output;
        if (
          ["failed", "interrupted", "cancelled"].includes(record.state.phase)
        ) {
          if (Array.isArray(record.partial)) {
            const partial = record.partial as AlignedLine[];
            setLines((previous) =>
              previous.map(
                (l) =>
                  partial.find((p) => p.id === l.id) ?? {
                    ...l,
                    translation: undefined,
                  },
              ),
            );
            if (settings)
              provenance.current = {
                source: provenance.current?.source || { kind: "user" },
                targetLanguage: settings.preferences.targetLanguage,
                model: settings.model,
              };
          }
          throw new Error(record.state.errorCode || "工作已取消");
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error("已離開影片");
    } finally {
      if (workRef.current === work) activeRun.current = undefined;
      if (live.current && workRef.current === work) {
        setBusy(false);
        setProgress("");
      }
    }
  };
  const searchPayload =
    video && settings
      ? { video, sources: settings.sources.filter((s) => s.enabled) }
      : null;
  const startSearch = () =>
    attempt(async () => {
      if (!settings || !searchPayload || busy) return;
      const work: PendingWork = { cancelled: false };
      workRef.current = work;
      setBusy(true);
      try {
        setSearchReply(null);
        setCandidates(null);
        const receipt = {
          purpose: "search" as const,
          inputHash: await hashInput(searchPayload),
          settingsRevision: settings.settingsRevision,
          confirmedAt: Date.now(),
        };
        await checkWork(work);
        const state = await startOwnedRun(
          () =>
            request<RunState>({
              type: "search",
              video: searchPayload.video,
              consent: receipt,
            }),
          () => live.current && !work.cancelled,
          async (id) => {
            await request({ type: "cancel", runId: id });
          },
        );
        const result = (await poll(state, work)) as LyricSearchResult;
        if (live.current) {
          setSearchReply(result.text);
          setCandidates(result.error ? null : result.candidates);
          setError(result.error || "");
        }
      } catch (error) {
        if (work.cancelled) throw new WorkCancelled();
        throw error;
      } finally {
        if (live.current && workRef.current === work) setBusy(false);
      }
    });
  const startGenerate = (
    inputLines: AlignedLine[] = alignmentInput.current,
    editedBody?: string,
  ) =>
    attempt(async () => {
      if (!video || !settings || busy) return;
      setView("edit");
      if (!settings.configured) {
        setLines(inputLines);
        setMessage("歌詞已保留；請先設定 AI 服務，或使用已有時間戳的內容。 ");
        return;
      }
      // Validate edited JSON before any network request or draft changes.
      let body;
      if (editedBody !== undefined) {
        try {
          body = alignmentBodySchema.parse(JSON.parse(editedBody));
        } catch {
          throw new Error(
            "Request body 必須是有效 JSON，包含 model、messages 與 stream: false（上限 120000 字元）",
          );
        }
      }
      const work: PendingWork = {
        cancelled: false,
        controller: new AbortController(),
      };
      workRef.current = work;
      setBusy(true);
      setMessage("正在對齊歌詞…");
      try {
        let timing = cues;
        if (!timing.length) {
          setMessage("正在讀取 YouTube 轉錄稿…");
          timing = await request<Cue[]>({ type: "read-transcript" });
          if (!live.current) return;
          await checkWork(work);
          setCues(timing);
        }
        if (!timing.length && inputLines.some((l) => l.startMs === undefined))
          throw new Error("未取得可用轉錄稿，歌詞已保留，請稍後重新請求。");
        const acoustic = localAcoustic;
        body ??= alignmentBodySchema.parse(
          acoustic
            ? regionRequest(settings.model, inputLines, timing)
            : alignmentRequest(settings.model, inputLines, timing),
        );
        if (editedBody === undefined)
          setRequestBody(JSON.stringify(body, null, 2));
        alignmentInput.current = inputLines;
        setAlignmentReport("");
        const audioAssetId = acoustic
          ? await acquireYouTubeAudio(
              binding.videoId,
              video.durationMs,
              work.controller!.signal,
              (text) => {
                if (live.current) setProgress(text);
              },
            )
          : undefined;
        await checkWork(work);
        const payload = {
          video,
          lines: inputLines,
          cues: timing,
          targetLanguage: settings.preferences.targetLanguage,
          translate: false,
          body,
          ...(audioAssetId ? { audioAssetId } : {}),
          ...(audioAssetId
            ? { positionMs: Math.max(0, binding.video.currentTime * 1000) }
            : {}),
        };
        const receipt = {
          purpose: "generate" as const,
          inputHash: await hashInput(payload),
          settingsRevision: settings.settingsRevision,
          confirmedAt: Date.now(),
        };
        await checkWork(work);
        const state = await startOwnedRun(
          () =>
            request<RunState>({
              type: "generate",
              input: { ...payload, consent: receipt },
            }),
          () => live.current && !work.cancelled,
          async (id) => {
            await request({ type: "cancel", runId: id });
          },
        );
        const output = (await poll(state, work)) as {
          lines: AlignedLine[];
          response: string;
        };
        if (!live.current) return;
        setLines(output.lines.map(({ translation, ...line }) => line));
        setResponseText(output.response);
        provenance.current = {
          source: provenance.current?.source || { kind: "user" },
          targetLanguage: settings.preferences.targetLanguage,
          model: String(body.model),
        };
        const remaining = output.lines.filter(
          (l) =>
            !l.excluded && (l.startMs === undefined || l.endMs === undefined),
        ).length;
        setMessage(
          acoustic && remaining
            ? `已校時 ${output.lines.filter((l) => !l.excluded).length - remaining} 句，另有 ${remaining} 句待處理；已完成片段可播放，完整保存仍需處理待校時句。`
            : "AI 對齊完成，請檢查後套用並保存。",
        );
      } catch (error) {
        if (work.cancelled) throw new WorkCancelled();
        throw error;
      } finally {
        void request({ type: "audio-clear" }).catch(() => {});
        if (live.current && workRef.current === work) setBusy(false);
      }
    });
  const submitLyrics = async (
    draft: AlignedLine[],
    source?: DraftProvenance["source"],
  ) => {
    if (!draft.length) throw new Error("請先提供歌詞");
    const clean = draft.map(({ translation, ...line }) => line);
    setReviewTab("result");
    setOnlyPending(false);
    setLines(clean);
    alignmentInput.current = clean;
    setOffset(0);
    setRequestBody("");
    setResponseText("");
    provenance.current = {
      source:
        source ||
        (selected ? { kind: "user", url: selected.url } : { kind: "user" }),
      targetLanguage: settings?.preferences.targetLanguage || "ja",
      model: "",
    };
    if (
      video &&
      !validateTiming(clean, video.durationMs, 0).some(
        (issue) => issue.severity === "error",
      )
    ) {
      setView("edit");
      setMessage("已讀取時間戳，可直接套用並保存。");
      return;
    }
    await startGenerate(clean);
  };
  const useCandidate = (c: LyricCandidate) => {
    setSelected(c);
    setText(c.fullText || "");
    setCandidates(null);
    if (video)
      void attempt(async () => {
        const draft = candidateDraft(c, video.durationMs);
        if (draft.lines.length)
          await submitLyrics(draft.lines, {
            kind: "network",
            url: c.url,
            version: c.version,
          });
        else setView("paste");
      });
  };
  const result = async (resultLines = lines): Promise<SavedResult> => {
    if (!video || !settings) throw new Error("播放器尚未就緒");
    const errors = validateTiming(resultLines, video.durationMs, offset).filter(
      (x) => x.severity === "error",
    );
    if (errors.length)
      throw new Error(`有 ${errors.length} 句未完成校時，請修正或排除`);
    if (!resultLines.some((l) => !l.excluded))
      throw new Error("請至少保留一句歌詞");
    const actual = provenance.current || {
      source: { kind: "user" as const },
      targetLanguage: settings.preferences.targetLanguage,
      model: "",
    };
    return {
      schemaVersion: 1,
      key: {
        schemaVersion: 1,
        videoId: video.videoId,
        inputHash: await hashInput({
          lines: resultLines,
          targetLanguage: actual.targetLanguage,
          source: actual.source,
          model: actual.model,
        }),
        targetLanguage: actual.targetLanguage,
      },
      videoDurationMs: video.durationMs,
      source: actual.source,
      lines: resultLines,
      offsetMs: offset,
      model: actual.model,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  };
  const download = () =>
    attempt(async () => {
      const r = await result();
      const srt = toSrt(r.lines, "original", r.offsetMs, r.videoDurationMs);
      const url = URL.createObjectURL(
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
      <header inert={!!leaveAction}>
        <h2>AI 歌詞</h2>
        <div className="row">
          <button onClick={() => void request({ type: "open-options" })}>
            設定
          </button>
          <button aria-label="關閉面板" onClick={() => requestLeave("close")}>
            ×
          </button>
        </div>
      </header>
      <div className="workspace" inert={!!leaveAction}>
        <aside
          ref={editPage}
          hidden={view === "lyrics"}
          className={`panel-body operations stack ${view === "edit" ? "review-page" : ""}`}
          aria-label="歌詞操作與設定"
          tabIndex={0}
        >
          {view !== "edit" && (
            <>
              <button
                className="back-button"
                onClick={() => requestLeave("return")}
              >
                ← 返回歌詞
              </button>
              {view !== "lyrics" && <h3>{video?.title || "目前影片"}</h3>}
              <p className="muted" role="status">
                {message}
              </p>
              {error && (
                <p role="alert" className="notice error">
                  {error}
                </p>
              )}
              {busy && (
                <div className="notice">
                  <p>處理中…{progress}</p>
                  <button onClick={() => requestLeave("stop")}>取消工作</button>
                </div>
              )}
            </>
          )}
          {view === "search" && (
            <section className="section">
              <h3>AI 尋找歌詞</h3>
              <p>
                搜尋來源：
                {settings?.sources
                  .filter((s) => s.enabled)
                  .map((s) => s.name)
                  .join("、") || "尚未勾選來源"}
              </p>
              <button
                className="primary"
                disabled={
                  busy ||
                  !settings?.configured ||
                  !settings.sources.some((s) => s.enabled)
                }
                onClick={(event) => {
                  if (isUserAction(event)) void startSearch();
                }}
              >
                開始搜尋
              </button>
              {searchReply !== null && <AiReply text={searchReply} />}
              {candidates && (
                <Candidates candidates={candidates} onSelect={useCandidate} />
              )}
              <button disabled={busy} onClick={() => setView("paste")}>
                改用貼上歌詞
              </button>
              <button disabled={busy} onClick={() => setView("import")}>
                匯入 LRC／SRT
              </button>
            </section>
          )}
          {view === "paste" && (
            <section className="section">
              <h3>貼上歌詞</h3>
              {selected && (
                <a
                  href={selected.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  開啟來源並取得全文
                </a>
              )}
              <textarea
                aria-label="歌詞全文"
                placeholder="每行一句歌詞"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button
                disabled={busy || !video}
                onClick={(event) =>
                  (!settings?.configured || isUserAction(event)) &&
                  attempt(async () => {
                    if (video)
                      await submitLyrics(
                        parseLyrics(
                          new TextEncoder().encode(text),
                          "txt",
                          video.durationMs,
                        ),
                      );
                  })
                }
              >
                使用貼上歌詞
              </button>
            </section>
          )}
          {view === "import" && (
            <section className="section">
              <h3>匯入 LRC／SRT</h3>
              <label>
                匯入 LRC／SRT
                <input
                  type="file"
                  accept=".lrc,.srt"
                  disabled={busy || !video}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    setImported(undefined);
                    if (file)
                      void attempt(async () => {
                        if (file.size > 2097152)
                          throw new Error("檔案超過 2 MiB");
                        const ext = file.name.toLowerCase().split(".").at(-1);
                        if (ext !== "lrc" && ext !== "srt")
                          throw new Error("請選擇 LRC 或 SRT 檔案");
                        const bytes = new Uint8Array(await file.arrayBuffer());
                        if (video) {
                          const draft = parseLyrics(
                            bytes,
                            ext,
                            video.durationMs,
                          );
                          if (!draft.length)
                            throw new Error("檔案沒有可用歌詞");
                          setImported({ name: file.name, lines: draft });
                        }
                      });
                  }}
                />
              </label>
              {imported && (
                <>
                  <p>
                    {imported.name} · {imported.lines.length} 句
                  </p>
                  <pre>
                    {imported.lines
                      .map(
                        (l) =>
                          `${l.startMs === undefined ? "未校時" : (l.startMs / 1000).toFixed(3)} → ${l.endMs === undefined ? "未校時" : (l.endMs / 1000).toFixed(3)}  ${l.original}`,
                      )
                      .join("\n")}
                  </pre>
                  <button
                    disabled={busy}
                    onClick={(event) => {
                      if (settings?.configured && !isUserAction(event)) return;
                      setSelected(undefined);
                      void attempt(() =>
                        submitLyrics(imported.lines, { kind: "user" }),
                      );
                    }}
                  >
                    確認並開始對齊
                  </button>
                </>
              )}
            </section>
          )}
          {view === "saved" && (
            <section>
              <h3>本機保存的版本</h3>
              {saved.map((r) => (
                <div key={r.key.inputHash}>
                  <p>{r.lines.length} 句</p>
                  <button
                    onClick={() => {
                      setLines(r.lines.map(({ translation, ...l }) => l));
                      provenance.current = provenanceOf(r);
                      setOffset(r.offsetMs);
                      alignmentInput.current = [];
                      setRequestBody("");
                      setResponseText("");
                      setMessage("已載入本機結果，不會呼叫 AI");
                      setView("edit");
                    }}
                  >
                    載入
                  </button>
                </div>
              ))}
            </section>
          )}
          {view === "edit" && (
            <>
              <div className="review-heading">
                <div className="review-back">
                  <button onClick={() => requestLeave("return")}>
                    ← 返回歌詞
                  </button>
                  <strong>對齊結果</strong>
                </div>
                <p className="review-title" title={video?.title}>
                  {video?.title || "目前影片"}
                </p>
                <p className="review-count" role="status">
                  {busy
                    ? `處理中…${progress}`
                    : `已對齊 ${lines.filter((l) => !l.excluded).length - pending.length} 句`}
                  {!busy && pending.length > 0 && (
                    <span>{pending.length} 句待處理</span>
                  )}
                </p>
                <span className="visually-hidden">{message}</span>
                {busy && (
                  <button onClick={() => requestLeave("stop")}>取消工作</button>
                )}
              </div>
              <div
                className="review-tabs"
                role="tablist"
                aria-label="對齊工作區"
                onKeyDown={(e) => {
                  const tabs = ["result", "request", "response"] as const;
                  const next =
                    e.key === "ArrowRight"
                      ? (tabs.indexOf(reviewTab) + 1) % 3
                      : e.key === "ArrowLeft"
                        ? (tabs.indexOf(reviewTab) + 2) % 3
                        : -1;
                  if (next >= 0) {
                    e.preventDefault();
                    setReviewTab(tabs[next]);
                    (e.currentTarget.children[next] as HTMLElement).focus();
                  }
                }}
              >
                {(
                  [
                    ["result", "歌詞結果"],
                    ["request", "請求內容"],
                    ["response", "原始回覆"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    id={`review-tab-${id}`}
                    role="tab"
                    aria-selected={reviewTab === id}
                    aria-controls={`review-${id}`}
                    tabIndex={reviewTab === id ? 0 : -1}
                    onClick={() => setReviewTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="review-content">
                {error && (
                  <p role="alert" className="review-error">
                    {error}
                  </p>
                )}
                {!settings?.configured && (
                  <p className="notice">
                    先在設定頁填入你的 AI 服務；貼上、匯入與預覽仍可使用。
                    <button
                      onClick={() => void request({ type: "open-options" })}
                    >
                      前往設定
                    </button>
                  </p>
                )}
                <div
                  role="tabpanel"
                  id="review-result"
                  aria-labelledby="review-tab-result"
                  hidden={reviewTab !== "result"}
                >
                  <div className="review-filter">
                    <span>{onlyPending ? "待處理歌詞" : "全部歌詞"}</span>
                    <button
                      aria-pressed={onlyPending}
                      onClick={() => setOnlyPending((v) => !v)}
                    >
                      {onlyPending
                        ? "顯示全部"
                        : `只看待處理 ${pending.length}`}
                    </button>
                  </div>
                  <div aria-label="逐句時間戳" className="review-lines">
                    {lines
                      .filter(
                        (l) =>
                          !onlyPending || pending.some((p) => p.id === l.id),
                      )
                      .map((l) => (
                        <details
                          key={l.id}
                          className={`review-line ${pending.some((p) => p.id === l.id) ? "pending" : ""} ${l.excluded ? "excluded" : ""}`}
                        >
                          <summary>
                            <small>
                              {l.excluded
                                ? "已排除"
                                : `${stamp(l.startMs)}–${stamp(l.endMs)}`}
                            </small>
                            <span>{l.original}</span>
                          </summary>
                          {l.startMs !== undefined && (
                            <button
                              onClick={() => {
                                binding.video.currentTime =
                                  Math.max(0, l.startMs! + offset) / 1000;
                                void binding.video.play().catch(() => {});
                              }}
                            >
                              播放這句
                            </button>
                          )}
                          <Editor
                            disabled={busy}
                            lines={[l]}
                            lineOffset={lines.indexOf(l)}
                            onChange={(edited) => {
                              const updated = lines.map((item) =>
                                item.id === l.id ? edited[0] : item,
                              );
                              setLines(updated);
                              alignmentInput.current = updated;
                              setRequestBody("");
                              previewKey.current = undefined;
                              overlay.stop();
                              setAppliedLines([]);
                            }}
                            currentMs={() =>
                              Math.round(binding.video.currentTime * 1000)
                            }
                            seek={(ms) => {
                              binding.video.currentTime = ms / 1000;
                            }}
                          />
                        </details>
                      ))}
                    {onlyPending && !pending.length && (
                      <p>所有歌詞都已有時間。</p>
                    )}
                  </div>
                </div>
                <div
                  role="tabpanel"
                  id="review-request"
                  aria-labelledby="review-tab-request"
                  hidden={reviewTab !== "request"}
                  className="review-request"
                >
                  <label>
                    Request body
                    <textarea
                      aria-label="Request body"
                      spellCheck={false}
                      rows={16}
                      value={requestBody}
                      disabled={busy}
                      onChange={(e) => setRequestBody(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={busy || !settings?.configured || !lines.length}
                    onClick={(event) =>
                      isUserAction(event) &&
                      startGenerate(
                        alignmentInput.current.length
                          ? alignmentInput.current
                          : lines,
                        requestBody || undefined,
                      )
                    }
                  >
                    重新請求
                  </button>
                </div>
                <div
                  role="tabpanel"
                  id="review-response"
                  aria-labelledby="review-tab-response"
                  hidden={reviewTab !== "response"}
                >
                  <pre className="review-response">
                    {responseText || "尚未收到 AI 回覆。"}
                  </pre>
                  {alignmentReport && (
                    <details className="alignment-diagnostics">
                      <summary>AI 校時診斷（原始回覆與判定）</summary>
                      <pre>{alignmentReport}</pre>
                    </details>
                  )}
                </div>
                <details
                  className="review-offset"
                  hidden={reviewTab !== "result"}
                >
                  <summary>整體時間偏移與匯出</summary>
                  <label>
                    整體偏移（秒，正數為延後）
                    <input
                      type="number"
                      step="0.1"
                      value={offset / 1000}
                      onChange={(e) =>
                        setOffset(Math.round(Number(e.target.value) * 1000))
                      }
                    />
                  </label>
                  <button disabled={busy} onClick={download}>
                    下載 SRT
                  </button>
                </details>
              </div>
              <div className="review-footer">
                {pending.length > 0 ? (
                  <div className="review-pending">
                    <span>尚有 {pending.length} 句待處理</span>
                    <button
                      onClick={() => {
                        setReviewTab("result");
                        setOnlyPending(true);
                      }}
                    >
                      檢查問題
                    </button>
                  </div>
                ) : (
                  <span className="muted">
                    {busy ? "正在處理歌詞" : "確認後才會套用到影片"}
                  </span>
                )}
                <button
                  className="primary"
                  disabled={busy || !lines.length || pending.length > 0}
                  onClick={() =>
                    attempt(async () => {
                      const r = await result();
                      await request({ type: "results-save", result: r });
                      if (!live.current) return;
                      overlay.setResult(r, "original", settings?.preferences);
                      setAppliedLines(r.lines);
                      setAppliedOffset(r.offsetMs);
                      setSaved((previous) => [
                        r,
                        ...previous.filter(
                          (item) => item.key.inputHash !== r.key.inputHash,
                        ),
                      ]);
                      setMessage(
                        "已套用並保存在本機。如與原生字幕重疊，請關閉 YouTube CC。",
                      );
                      setView("lyrics");
                    })
                  }
                >
                  套用並保存
                </button>
              </div>
            </>
          )}
        </aside>
        <section
          ref={lyricsPage}
          hidden={view !== "lyrics"}
          className="lyrics-preview"
          aria-label="字幕編輯與預覽"
          tabIndex={0}
        >
          {appliedLines.length > 0 && (
            <div className="lyrics-toolbar">
              <h3>{video?.title || "目前影片"}</h3>
              <div className="row">
                <button onClick={() => setView("edit")}>製作／編輯</button>
                <button onClick={() => setView("paste")}>貼上歌詞</button>
                <button onClick={() => setView("import")}>匯入 LRC／SRT</button>
                {settings?.configured && (
                  <button onClick={() => setView("search")}>AI 尋找歌詞</button>
                )}
              </div>
            </div>
          )}
          {appliedLines.length > 0 ? (
            <LyricsPreview
              lines={appliedLines}
              mode="original"
              offsetMs={appliedOffset}
              video={binding.video}
              seek={(ms) => {
                binding.video.currentTime = ms / 1000;
                void binding.video.play().catch(() => {});
              }}
            />
          ) : metadataLoading ? (
            <ContentSkeleton label="正在載入影片資訊" />
          ) : (
            <div className="empty-preview">
              <p className="muted">尚未加入歌詞</p>
              <h3>{video?.title || "目前影片"}</h3>
              <p className="muted">
                {video?.channel}
                {video?.durationMs
                  ? ` · ${Math.floor(video.durationMs / 60000)}:${String(Math.floor(video.durationMs / 1000) % 60).padStart(2, "0")}`
                  : ""}
              </p>
              {!settings?.configured ? (
                <>
                  <p className="notice">
                    先在設定頁填入你自己的 AI 服務，即可使用 AI 搜尋與對齊。
                  </p>
                  <p>
                    貼上、匯入及手動校時現在就能使用。請使用「貼上歌詞」或「匯入
                    LRC／SRT」加入 LRC／SRT，歌詞會完整顯示在這裡。
                  </p>
                  <button
                    className="primary"
                    onClick={() => void request({ type: "open-options" })}
                  >
                    前往設定
                  </button>
                  <p className="muted">
                    設定 API 網址、API Token
                    與模型名稱並儲存後，返回影片即可啟用 AI。
                  </p>
                </>
              ) : (
                <p className="muted">
                  貼上、匯入或使用 AI
                  尋找歌詞。每一句會顯示在這裡，點擊已校時的歌詞可跳至該句。
                </p>
              )}
              <div className="empty-actions">
                {settings?.configured && (
                  <button
                    className="primary"
                    disabled={!video}
                    onClick={() => setView("search")}
                  >
                    AI 尋找歌詞
                  </button>
                )}
                <button disabled={!video} onClick={() => setView("paste")}>
                  貼上歌詞
                </button>
                <button disabled={!video} onClick={() => setView("import")}>
                  匯入 LRC／SRT
                </button>
                {lines.length > 0 && (
                  <button onClick={() => setView("edit")}>繼續編輯草稿</button>
                )}
                {saved.length > 0 && (
                  <button onClick={() => setView("saved")}>
                    本機保存的版本
                  </button>
                )}
              </div>
              {view === "lyrics" && error && (
                <p role="alert" className="notice error">
                  {error}
                </p>
              )}
            </div>
          )}
        </section>
      </div>
      {leaveAction && (
        <div className="stop-backdrop">
          <section
            className="stop-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="stop-title"
            aria-describedby="stop-description"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !stopping) {
                event.preventDefault();
                continueWaiting();
              }
              if (event.key === "Tab") {
                const buttons = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button:not(:disabled)",
                  ),
                );
                const first = buttons[0],
                  last = buttons.at(-1);
                if (event.shiftKey && event.target === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && event.target === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <h3 id="stop-title">要取消目前的工作嗎？</h3>
            <p id="stop-description">
              AI 回覆仍在等待中。取消後會保留歌詞、請求內容與已有結果。
            </p>
            {stopError && (
              <p role="alert" className="error notice">
                {stopError}
              </p>
            )}
            <div className="stop-actions">
              <button autoFocus disabled={stopping} onClick={continueWaiting}>
                繼續等待
              </button>
              <button disabled={stopping} onClick={() => void confirmStop()}>
                {stopping
                  ? "正在取消…"
                  : leaveAction === "return"
                    ? "取消工作並返回"
                    : leaveAction === "close"
                      ? "取消工作並關閉"
                      : "取消工作"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
