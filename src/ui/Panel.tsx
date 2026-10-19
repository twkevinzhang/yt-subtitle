import React, { useEffect, useRef, useState } from "react";
import type {
  AlignedLine,
  CaptionTrack,
  Cue,
  DisplayMode,
  LyricCandidate,
  PlayerBinding,
  PublicSettings,
  RunState,
  SavedResult,
  VideoContext,
} from "../shared/types";
import { request } from "../shared/messages";
import { hashInput } from "../background/results";
import { parseLyrics, validateTiming } from "../lyrics/formats";
import { toSrt, safeFilename } from "../lyrics/export";
import { Consent } from "./Consent";
import { Candidates } from "./Candidates";
import { Editor } from "./Editor";
import { LyricsPreview } from "./LyricsPreview";
import { ContentSkeleton } from "./Skeleton";
import type { createOverlay } from "../content/overlay";
import type { RunRecord } from "../background/runs";
import {
  candidateDraft,
  provenanceOf,
  type DraftProvenance,
} from "../lyrics/draft";
import { startOwnedRun } from "./owned-run";
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
    [tracks, setTracks] = useState<CaptionTrack[]>([]),
    [trackId, setTrackId] = useState(""),
    [cues, setCues] = useState<Cue[]>([]);
  const [view, setView] = useState<"lyrics" | "edit">("lyrics");
  const editPage = useRef<HTMLElement>(null);
  const lyricsPage = useRef<HTMLElement>(null);
  const previousView = useRef(view);
  useEffect(() => {
    if (previousView.current !== view) {
      (view === "edit" ? editPage : lyricsPage).current?.focus({
        preventScroll: true,
      });
      previousView.current = view;
    }
  }, [view]);
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [captionsLoading, setCaptionsLoading] = useState(false);
  const [message, setMessage] = useState("正在檢查播放器…"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [candidates, setCandidates] = useState<LyricCandidate[] | null>(null),
    [selected, setSelected] = useState<LyricCandidate>(),
    [text, setText] = useState(""),
    [lines, setLines] = useState<AlignedLine[]>([]),
    [offset, setOffset] = useState(0),
    [mode, setMode] = useState<DisplayMode>("original"),
    [translate, setTranslate] = useState(false),
    [saved, setSaved] = useState<SavedResult[]>([]),
    [confirm, setConfirm] = useState<"search" | "generate" | null>(null),
    [progress, setProgress] = useState("");
  const live = useRef(true),
    activeRun = useRef<string | undefined>(undefined),
    originalHash = useRef("");
  const userProvided = useRef(true);
  const provenance = useRef<DraftProvenance | undefined>(undefined);
  const [previousDraft, setPreviousDraft] = useState<{
    lines: AlignedLine[];
    offset: number;
    text: string;
    selected: LyricCandidate | undefined;
    provenance: DraftProvenance | undefined;
    hash: string;
  }>();
  useEffect(() => {
    if (publicSettings) {
      setSettings(publicSettings);
      setConfirm(null);
    }
  }, [publicSettings?.settingsRevision, publicSettings?.configured]);
  useEffect(() => {
    const refresh = () => {
      void request<PublicSettings>({ type: "settings-public" })
        .then((s) => {
          if (live.current) {
            setSettings(s);
            setConfirm(null);
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
          setMode(s.preferences.mode);
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
        setTracks(ctx.tracks);
        setMetadataLoading(false);
        const track = ctx.tracks.find((t) => !t.isTranslated);
        setMessage(
          track
            ? "已發現字幕軌，正在讀取內容…"
            : "這支影片未提供可讀取的字幕；可匯入或手動校時",
        );
        if (track) {
          setTrackId(track.id);
          setCaptionsLoading(true);
          try {
            const c = await request<Cue[]>({
              type: "read-track",
              trackId: track.id,
            });
            if (live.current) {
              setCues(c);
              setMessage(`已讀取 ${c.length} 段字幕，可用來對齊歌詞`);
            }
          } catch {
            if (live.current)
              setMessage("字幕內容讀取失敗，請啟用原生字幕後按「重新讀取」");
          } finally {
            if (live.current) setCaptionsLoading(false);
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
      if (live.current) setError((e as Error).message);
    }
  };
  const poll = async (state: RunState): Promise<unknown> => {
    if (!live.current) {
      await request({ type: "cancel", runId: state.runId });
      throw new Error("已離開影片，工作已取消");
    }
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
        if (!record) throw new Error("工作已中斷，請重新開始");
        setProgress(
          `已完成 ${record.state.completedLineIds.length} 句；已送出 ${record.state.requestCount}/20 次請求`,
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
                    translation: translate ? undefined : l.translation,
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
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error("已離開影片");
    } finally {
      activeRun.current = undefined;
      if (live.current) {
        setBusy(false);
        setProgress("");
      }
    }
  };
  const searchPayload =
    video && settings
      ? { video, sources: settings.sources.filter((s) => s.enabled) }
      : null;
  const generatePayload =
    video && settings
      ? {
          video,
          lines,
          cues,
          targetLanguage: settings.preferences.targetLanguage,
          translate,
        }
      : null;
  const startSearch = () =>
    attempt(async () => {
      if (!settings || !searchPayload) return;
      setConfirm(null);
      const receipt = {
        purpose: "search" as const,
        inputHash: await hashInput(searchPayload),
        settingsRevision: settings.settingsRevision,
        confirmedAt: Date.now(),
      };
      const state = await startOwnedRun(
        () =>
          request<RunState>({
            type: "search",
            video: searchPayload.video,
            consent: receipt,
          }),
        () => live.current,
        async (id) => {
          await request({ type: "cancel", runId: id });
        },
      );
      const result = await poll(state);
      if (live.current) setCandidates(result as LyricCandidate[]);
    });
  const startGenerate = () =>
    attempt(async () => {
      if (!settings || !generatePayload) return;
      setConfirm(null);
      const receipt = {
        purpose: "generate" as const,
        inputHash: await hashInput(generatePayload),
        settingsRevision: settings.settingsRevision,
        confirmedAt: Date.now(),
      };
      const state = await startOwnedRun(
        () =>
          request<RunState>({
            type: "generate",
            input: { ...generatePayload, consent: receipt },
          }),
        () => live.current,
        async (id) => {
          await request({ type: "cancel", runId: id });
        },
      );
      const result = await poll(state);
      if (live.current) {
        setLines(result as AlignedLine[]);
        provenance.current = {
          source: provenance.current?.source || { kind: "user" },
          targetLanguage: translate
            ? generatePayload.targetLanguage
            : provenance.current?.targetLanguage ||
              generatePayload.targetLanguage,
          model: settings.model,
        };
      }
    });
  const useCandidate = (c: LyricCandidate) => {
    if (lines.length)
      setPreviousDraft({
        lines,
        offset,
        text,
        selected,
        provenance: provenance.current,
        hash: originalHash.current,
      });
    userProvided.current = !c.fullText && !c.syncedLyrics;
    setSelected(c);
    setText(c.fullText || "");
    setLines([]);
    setOffset(0);
    originalHash.current = "";
    provenance.current = {
      source: {
        kind: userProvided.current ? "user" : "network",
        url: c.url,
        version: c.version,
      },
      targetLanguage: settings?.preferences.targetLanguage || "zh-Hant",
      model: settings?.model || "",
    };
    if (video)
      void attempt(async () => {
        const draft = candidateDraft(c, video.durationMs);
        setLines(draft.lines);
        originalHash.current = await hashInput(draft.raw);
      });
    setCandidates(null);
  };
  const result = async (): Promise<SavedResult> => {
    if (!video || !settings) throw new Error("播放器尚未就緒");
    const errors = validateTiming(lines, video.durationMs, offset).filter(
      (x) => x.severity === "error",
    );
    if (errors.length)
      throw new Error(`有 ${errors.length} 句未完成校時，請修正或排除`);
    if (!lines.some((l) => !l.excluded)) throw new Error("請至少保留一句歌詞");
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
          lines,
          targetLanguage: actual.targetLanguage,
          source: actual.source,
          model: actual.model,
        }),
        targetLanguage: actual.targetLanguage,
      },
      videoDurationMs: video.durationMs,
      source: actual.source,
      lines,
      offsetMs: offset,
      model: actual.model,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  };
  const download = () =>
    attempt(async () => {
      const r = await result();
      const srt = toSrt(r.lines, mode, r.offsetMs, r.videoDurationMs);
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
    <div className="panel" role="region" aria-label="AI 歌詞工作面板">
      <header>
        <h2>AI 歌詞</h2>
        <div className="row">
          <button onClick={() => void request({ type: "open-options" })}>
            設定
          </button>
          <button aria-label="關閉面板" onClick={onClose}>
            ×
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside
          ref={editPage}
          hidden={view !== "edit"}
          className="panel-body operations stack"
          aria-label="歌詞操作與設定"
          tabIndex={0}
        >
          <button className="back-button" onClick={() => setView("lyrics")}>
            ← 返回歌詞
          </button>
          {settings?.configured && (
            <div className="section">
              {!video ? (
                <ContentSkeleton label="正在讀取影片資料" />
              ) : (
                <h3>{video.title}</h3>
              )}
              {captionsLoading ? (
                <div
                  role="status"
                  aria-label="正在讀取字幕"
                  className="caption-loading"
                >
                  <span className="skeleton-bar" aria-hidden="true" />
                  <small>正在讀取字幕；貼上與匯入仍可使用。</small>
                </div>
              ) : (
                <p className="muted">{message}</p>
              )}
              {tracks.length > 0 && (
                <div className="row">
                  <select
                    aria-label="字幕來源"
                    value={trackId}
                    disabled={busy}
                    onChange={(e) => setTrackId(e.target.value)}
                  >
                    {tracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                        {t.isAuto ? "（自動產生）" : ""}
                        {t.isTranslated ? "（翻譯）" : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={busy}
                    onClick={() =>
                      attempt(async () => {
                        const c = await request<Cue[]>({
                          type: "read-track",
                          trackId,
                        });
                        setCues(c);
                        setMessage(`已讀取 ${c.length} 段字幕`);
                      })
                    }
                  >
                    重新讀取
                  </button>
                </div>
              )}
              <button onClick={() => void request({ type: "open-options" })}>
                開啟設定
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          {!settings?.configured && lines.length > 0 && (
            <p className="notice">
              先在設定頁填入你自己的 AI 服務，解鎖搜尋、對齊與翻譯。
              <button onClick={() => void request({ type: "open-options" })}>
                前往設定
              </button>
            </p>
          )}
          {!settings?.configured && lines.length > 0 && (
            <p role="status" className="muted">
              {message}
            </p>
          )}
          {busy ? (
            <div className="notice">
              <p>處理中…{progress}</p>
              <button
                onClick={() =>
                  activeRun.current &&
                  void request({ type: "cancel", runId: activeRun.current })
                }
              >
                取消工作
              </button>
            </div>
          ) : (
            <>
              {saved.length > 0 && (
                <section>
                  <h3>本機保存的版本</h3>
                  {saved.map((r) => (
                    <div className="row" key={r.key.inputHash}>
                      <small>
                        {new Date(r.updatedAt).toLocaleString()}／
                        {r.lines.length} 句／{r.key.targetLanguage}
                      </small>
                      <button
                        onClick={() => {
                          setLines(r.lines);
                          setOffset(r.offsetMs);
                          setSelected(undefined);
                          provenance.current = provenanceOf(r);
                          originalHash.current = r.key.inputHash;
                          setMessage("已載入本機結果，不會呼叫 AI");
                        }}
                      >
                        載入
                      </button>
                    </div>
                  ))}
                </section>
              )}
              {settings?.configured && (
                <section className="section">
                  <h3>尋找歌詞</h3>
                  {previousDraft && (
                    <button
                      onClick={() => {
                        setLines(previousDraft.lines);
                        setOffset(previousDraft.offset);
                        setText(previousDraft.text);
                        setSelected(previousDraft.selected);
                        provenance.current = previousDraft.provenance;
                        originalHash.current = previousDraft.hash;
                        setPreviousDraft(undefined);
                      }}
                    >
                      返回上一份草稿
                    </button>
                  )}
                  <p>由你的 AI 服務搜尋勾選來源，選好版本後再對齊。</p>
                  <button
                    className="primary"
                    disabled={
                      !settings?.configured ||
                      !settings.sources.some((s) => s.enabled) ||
                      !video
                    }
                    onClick={() => setConfirm("search")}
                  >
                    搜尋歌詞
                  </button>
                  {settings && !settings.sources.some((s) => s.enabled) && (
                    <p>尚未勾選歌詞來源。</p>
                  )}
                </section>
              )}
              {settings?.configured &&
                confirm === "search" &&
                searchPayload && (
                  <Consent
                    title="開始搜尋"
                    endpoint={settings!.baseUrl}
                    payload={searchPayload}
                    onConfirm={startSearch}
                    onCancel={() => setConfirm(null)}
                  />
                )}
              {settings?.configured && candidates && (
                <Candidates candidates={candidates} onSelect={useCandidate} />
              )}
              <section className="section">
                <h3>
                  {selected ? `選定版本：${selected.title}` : "貼上或匯入歌詞"}
                </h3>
                {selected && (
                  <p>
                    <a
                      href={selected.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      開啟來源並取得全文
                    </a>
                    ；貼入文字由你提供，不代表已核實。
                  </p>
                )}
                <textarea
                  aria-label="歌詞全文"
                  placeholder="每行一句歌詞；也可以直接匯入 LRC 或 SRT。"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <div className="row">
                  <button
                    disabled={!video}
                    onClick={() =>
                      attempt(async () => {
                        if (!video) throw new Error("影片尚未就緒");
                        setLines(
                          parseLyrics(
                            new TextEncoder().encode(text),
                            "txt",
                            video.durationMs,
                          ),
                        );
                        userProvided.current = true;
                        provenance.current = {
                          source: selected
                            ? {
                                kind: "user",
                                url: selected.url,
                                version: selected.version,
                              }
                            : { kind: "user" },
                          targetLanguage:
                            settings?.preferences.targetLanguage || "zh-Hant",
                          model: "",
                        };
                        originalHash.current = await hashInput(text);
                        setConfirm(null);
                      })
                    }
                  >
                    使用貼上歌詞
                  </button>
                  <label>
                    匯入 LRC／SRT
                    <input
                      type="file"
                      disabled={!video}
                      accept=".lrc,.srt,.txt"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          void attempt(async () => {
                            if (file.size > 2097152)
                              throw new Error("檔案超過 2 MiB");
                            if (!video) throw new Error("影片尚未就緒");
                            const bytes = new Uint8Array(
                              await file.arrayBuffer(),
                            );
                            const ext = file.name
                              .toLowerCase()
                              .split(".")
                              .at(-1);
                            setLines(
                              parseLyrics(
                                bytes,
                                ext === "lrc"
                                  ? "lrc"
                                  : ext === "srt"
                                    ? "srt"
                                    : "txt",
                                video.durationMs,
                              ),
                            );
                            setSelected(undefined);
                            provenance.current = {
                              source: { kind: "user" },
                              targetLanguage:
                                settings?.preferences.targetLanguage ||
                                "zh-Hant",
                              model: "",
                            };
                            originalHash.current = await hashInput([...bytes]);
                            setConfirm(null);
                          });
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </section>
              {lines.length > 0 && (
                <>
                  <section className="section">
                    <label>
                      <input
                        type="checkbox"
                        disabled={!settings?.configured}
                        checked={translate}
                        onChange={(e) => setTranslate(e.target.checked)}
                      />
                      生成譯文（
                      {settings?.preferences.targetLanguage || "zh-Hant"}）
                    </label>
                    <p>
                      <small>
                        本次最多 {Math.ceil(lines.length / 40)} 批；每個請求 120
                        秒、整次 10 分鐘，最多 20 次。
                      </small>
                    </p>
                    <button
                      disabled={
                        !settings?.configured ||
                        (!cues.length &&
                          lines.some(
                            (l) => !l.excluded && l.startMs === undefined,
                          )) ||
                        (!translate &&
                          lines.every((l) => l.startMs !== undefined))
                      }
                      onClick={() => setConfirm("generate")}
                    >
                      對齊／生成譯文
                    </button>
                    {!cues.length && (
                      <p className="muted">
                        沒有可用字幕時，請逐句手動校時或匯入帶時間的檔案。
                      </p>
                    )}
                  </section>
                  {settings?.configured &&
                    confirm === "generate" &&
                    generatePayload && (
                      <Consent
                        title="開始對齊／翻譯"
                        endpoint={settings!.baseUrl}
                        payload={generatePayload}
                        onConfirm={startGenerate}
                        onCancel={() => setConfirm(null)}
                      />
                    )}
                  <Editor
                    lines={lines}
                    onChange={setLines}
                    currentMs={() =>
                      Math.round(binding.video.currentTime * 1000)
                    }
                    seek={(ms) => {
                      binding.video.currentTime = ms / 1000;
                      void binding.video.play().catch(() => {});
                    }}
                  />
                  <section className="section">
                    <label>
                      <span>整體偏移（秒，正數為延後）</span>
                      <input
                        type="number"
                        step="0.1"
                        value={offset / 1000}
                        onChange={(e) =>
                          setOffset(Math.round(Number(e.target.value) * 1000))
                        }
                      />
                    </label>
                    <p className="muted">
                      {video &&
                      validateTiming(lines, video.durationMs, offset).filter(
                        (i) => i.severity === "warning",
                      ).length > 0
                        ? "部分句子時間重疊，請確認是否符合演唱。"
                        : ""}
                    </p>
                    <div className="row">
                      <button
                        className="primary"
                        onClick={() =>
                          attempt(async () => {
                            const r = await result();
                            overlay.setResult(r, mode, settings?.preferences);
                            await request({ type: "results-save", result: r });
                            setSaved(
                              await request<SavedResult[]>({
                                type: "results-list",
                              }),
                            );
                            setMessage(
                              "已套用並保存在本機。如與原生字幕重疊，請關閉 YouTube CC。",
                            );
                          })
                        }
                      >
                        套用並保存
                      </button>
                      <button onClick={download}>下載 SRT</button>
                      <button onClick={() => overlay.stop()}>停止顯示</button>
                    </div>
                  </section>
                </>
              )}
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
          {lines.length > 0 && (
            <div className="lyrics-toolbar">
              <h3>{video?.title || "目前影片"}</h3>
              <div className="row">
                <label>
                  <span>顯示模式</span>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as DisplayMode)}
                  >
                    <option value="original">原文</option>
                    <option
                      value="bilingual"
                      disabled={lines.some(
                        (l) => !l.excluded && !l.translation,
                      )}
                    >
                      原文＋譯文
                    </option>
                    <option
                      value="translation"
                      disabled={lines.some(
                        (l) => !l.excluded && !l.translation,
                      )}
                    >
                      僅譯文
                    </option>
                  </select>
                </label>
                <button onClick={() => setView("edit")}>製作／編輯</button>
              </div>
            </div>
          )}
          {lines.length > 0 ? (
            <LyricsPreview
              lines={lines}
              mode={mode}
              offsetMs={offset}
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
                    先在設定頁填入你自己的 AI 服務，即可使用 AI
                    搜尋、對齊與翻譯。
                  </p>
                  <p>
                    貼上、匯入及手動校時現在就能使用。請使用「貼上／匯入」加入
                    LRC／SRT，歌詞會完整顯示在這裡。
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
                    onClick={() => setView("edit")}
                  >
                    AI 尋找歌詞
                  </button>
                )}
                <button disabled={!video} onClick={() => setView("edit")}>
                  貼上／匯入
                </button>
                {saved.length > 0 && (
                  <button onClick={() => setView("edit")}>
                    本機保存的版本
                  </button>
                )}
              </div>
              {error && (
                <p role="alert" className="notice error">
                  {error}
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
