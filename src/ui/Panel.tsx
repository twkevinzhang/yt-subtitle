import React, { useState, useEffect, useRef } from "react";
import type {
  PlayerBinding,
  PublicSettings,
  LyricCandidate,
} from "../shared/types";
import type { createOverlay } from "../content/overlay";
import { request } from "../shared/messages";
import { useSubtitleWork } from "./use-subtitle-work";
import { ProgressSteps, StepIcon, stepLabels } from "./ProgressSteps";
import { toDashboardSteps } from "../subtitle/job-state";
import { SourceBadges, BrandLogo, candidateBrand } from "./SourceBadges";
import type { SearchRoute } from "../background/search-group";
import { parseSource } from "../subtitle/parse-source";
import {
  backView,
  type SubtitleView,
  type EntryMode,
} from "../subtitle/navigation";
const phaseTitles: Record<string, string> = {
  searching: "正在尋找這首歌的字幕",
  selecting: "選擇一份字幕",
  "acquiring-audio": "正在取得音訊",
  "preparing-model": "正在準備語音模型",
  transcribing: "正在辨識音訊",
  aligning: "正在對齊歌詞",
  validating: "正在驗證字幕",
  applying: "正在套用字幕",
  complete: "字幕已就緒",
  incomplete: "部分歌詞未匹配",
  failed: "字幕處理未完成",
  cancelled: "處理已取消",
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
  const { work, error, select, reset, cancel, setEntryMode } = useSubtitleWork(
      binding.videoId,
    ),
    [selected, setSelected] = useState<{
      candidate: LyricCandidate;
      route: SearchRoute;
    }>(),
    [localError, setLocalError] = useState(""),
    [pending, setPending] = useState(false),
    [paste, setPaste] = useState("");
  const [view, setView] = useState<SubtitleView>("method"),
    [origin, setOrigin] = useState<EntryMode>("ai");
  const published = useRef("");
  useEffect(() => {
    if (work?.cues) {
      const id =
        work.job.key.videoId +
        ":" +
        work.publishedSequence +
        ":" +
        publicSettings?.preferences.fontSize +
        ":" +
        publicSettings?.preferences.position;
      if (id !== published.current) {
        overlay.setCues(work.cues, publicSettings?.preferences);
        published.current = id;
      }
    }
  }, [work, overlay, publicSettings]);
  const perform = async (action: () => Promise<unknown>) => {
    setPending(true);
    setLocalError("");
    try {
      await action();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "操作失敗");
    } finally {
      setPending(false);
    }
  };
  const useSelected = () =>
    perform(async () => {
      if (!selected) throw Error("請先選擇字幕");
      const source = parseSource(
        selected.candidate.syncedLyrics ?? selected.candidate.fullText ?? "",
        selected.candidate.language,
      );
      setOrigin("ai");
      setView("processing");
      await select(source);
    });
  useEffect(() => {
    if (
      view === "processing" &&
      work &&
      ["complete", "failed", "incomplete", "cancelled"].includes(
        work.job.phase,
      ) &&
      !pending
    )
      setView("result");
  }, [view, work, pending]);
  const chooseMode = (mode: EntryMode) =>
    perform(async () => {
      await setEntryMode(mode);
      setOrigin(mode);
      setView(mode);
    });
  const goBack = () =>
    perform(async () => {
      if (view === "processing") await cancel();
      setLocalError("");
      setView(backView(view, origin));
    });
  const job = work?.job,
    steps = job ? toDashboardSteps(job) : [];
  return (
    <section className="subtitle-panel" aria-label="AI 歌詞">
      <header className="subtitle-header">
        <strong>AI 歌詞</strong>
        <nav aria-label="面板操作">
          <button
            disabled={pending}
            onClick={() => {
              if (
                window.confirm(
                  "重新載入會清除此影片的字幕工作並重新搜尋，確定繼續？",
                )
              )
                void perform(async () => {
                  await reset();
                  setView("method");
                  setPaste("");
                  setSelected(undefined);
                  overlay.stop();
                  published.current = "";
                });
            }}
          >
            重新載入
          </button>
          <button onClick={() => void request({ type: "open-options" })}>
            設定
          </button>
          <button aria-label="關閉面板" onClick={onClose}>
            ×
          </button>
        </nav>
      </header>
      <div className="subtitle-body">
        <p className="subtitle-play">▶ 影片持續播放</p>
        <h2>{work?.video.title ?? "字幕工作台"}</h2>
        {view !== "method" && (
          <button
            className="subtitle-back"
            onClick={() => void goBack()}
            disabled={pending && view !== "processing"}
          >
            ‹ 上一步
          </button>
        )}
        {view === "method" ? (
          <div className="subtitle-methods">
            <h3>選擇取得方式</h3>
            <button disabled={pending} onClick={() => void chooseMode("ai")}>
              AI 取得字幕
            </button>
            <button disabled={pending} onClick={() => void chooseMode("paste")}>
              貼入字幕
            </button>
            <p>兩種方式擇一使用，切換不影響影片播放。</p>
            {!work && (
              <button
                onClick={() =>
                  void perform(() => request({ type: "subtitle-ensure" }))
                }
              >
                讀取影片工作
              </button>
            )}
          </div>
        ) : (
          <>
            {view === "ai" &&
            (!publicSettings?.configured ||
              !publicSettings.preferences.autoSearchApproved) ? (
              <div className="subtitle-notice">
                請先在設定頁設定 AI 服務，並允許影片載入時自動搜尋字幕。
                <button onClick={() => void request({ type: "open-options" })}>
                  開啟設定
                </button>
              </div>
            ) : !job ? (
              <div>
                <p role="status">正在讀取影片與搜尋狀態…</p>
                <button
                  disabled={pending}
                  onClick={() =>
                    void perform(() => request({ type: "subtitle-ensure" }))
                  }
                >
                  重新讀取
                </button>
              </div>
            ) : (
              <>
                <div className="subtitle-hero">
                  <h3 role="status" aria-live="polite">
                    {view === "paste"
                      ? "貼入字幕"
                      : view === "ai" && job.phase !== "searching"
                        ? "選擇一份字幕"
                        : phaseTitles[job.phase]}
                  </h3>
                  <p>
                    {job.phase === "complete"
                      ? "完整字幕已顯示在影片中。"
                      : "整首完成後才套用，處理期間不影響影片播放。"}
                  </p>
                  {view !== "paste" && (
                    <ProgressSteps
                      job={
                        view === "ai"
                          ? {
                              ...job,
                              phase:
                                job.phase === "searching"
                                  ? "searching"
                                  : "selecting",
                              timed: false,
                              failedPhase: undefined,
                            }
                          : job
                      }
                    />
                  )}
                </div>
                {work.cues && job.phase !== "complete" && (
                  <p className="subtitle-play">目前顯示先前已完成的字幕。</p>
                )}
                {(view === "processing" || view === "result") && (
                  <div>
                    {steps.slice(1).map((step, i) => (
                      <div className="subtitle-row" key={step.id}>
                        <span>
                          <StepIcon index={i + 1} />
                          {stepLabels[i + 1]}
                        </span>
                        <span
                          aria-label={
                            {
                              waiting: "等待",
                              active: "處理中",
                              done: "已完成",
                              failed: "失敗",
                              skipped: "不需要",
                            }[step.status]
                          }
                          className={step.status}
                        >
                          {step.status === "done"
                            ? "✓"
                            : step.status === "active"
                              ? "◌"
                              : step.status === "failed"
                                ? "!"
                                : step.status === "skipped"
                                  ? "—"
                                  : "◷"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {view === "ai" && (
                  <>
                    <h3 className="subtitle-section-title">
                      {job.phase === "searching" ? "搜尋狀態" : "處理狀態"}
                    </h3>
                    <SourceBadges
                      search={work.search}
                      settings={publicSettings!}
                    />
                    <fieldset
                      className="subtitle-candidates"
                      disabled={pending}
                    >
                      <legend>選擇字幕</legend>
                      {(["configured", "comments", "web"] as const).flatMap(
                        (route) =>
                          (work.search?.routes[route].candidates ?? []).map(
                            (candidate) => (
                              <label key={route + candidate.id}>
                                <input
                                  type="radio"
                                  name="subtitle-candidate"
                                  checked={
                                    selected?.candidate.id === candidate.id &&
                                    selected.route === route
                                  }
                                  onChange={() =>
                                    setSelected({ candidate, route })
                                  }
                                />
                                <span>
                                  <strong>
                                    <BrandLogo
                                      {...candidateBrand(
                                        candidate,
                                        route,
                                        publicSettings!,
                                      )}
                                    />
                                  </strong>
                                  <span>
                                    {candidate.title} {candidate.artist}
                                  </span>
                                  <small>
                                    {candidate.language} ·{" "}
                                    {candidate.syncedLyrics
                                      ? "沿用時間碼"
                                      : "無時間碼，使用後對齊整首"}
                                  </small>
                                </span>
                              </label>
                            ),
                          ),
                      )}
                    </fieldset>
                    {work.search &&
                      Object.entries(work.search.routes).map(
                        ([route, result]) =>
                          result.error && (
                            <p className="subtitle-error" key={route}>
                              {route === "comments"
                                ? "YouTube"
                                : route === "web"
                                  ? "Google"
                                  : "設定來源"}
                              ：{result.error}
                              <button
                                disabled={pending}
                                onClick={() =>
                                  void perform(() =>
                                    request({
                                      type: "subtitle-retry-search",
                                      route: route as SearchRoute,
                                    }),
                                  )
                                }
                              >
                                重試此來源
                              </button>
                            </p>
                          ),
                      )}
                    {selected && (
                      <>
                        <button
                          className="primary"
                          disabled={pending}
                          onClick={() => void useSelected()}
                        >
                          使用所選字幕
                        </button>
                        <details open>
                          <summary>所選歌詞預覽</summary>
                          <pre>
                            {selected.candidate.syncedLyrics ??
                              selected.candidate.fullText ??
                              "此來源未提供歌詞內容"}
                          </pre>
                        </details>
                      </>
                    )}
                  </>
                )}
                {(view === "processing" || view === "result") && job.error && (
                  <div className="subtitle-error" role="alert">
                    {job.error.message}
                    <div className="subtitle-actions">
                      <button
                        disabled={pending || !work.source}
                        onClick={() =>
                          void perform(async () => {
                            setView("processing");
                            await select(work.source!);
                          })
                        }
                      >
                        重試
                      </button>
                      <button
                        onClick={() => {
                          setView(origin);
                          setLocalError("");
                          document
                            .querySelector("input[name=subtitle-candidate]")
                            ?.scrollIntoView({ block: "nearest" });
                        }}
                      >
                        更換來源
                      </button>
                    </div>
                  </div>
                )}
                {job.phase === "incomplete" && (
                  <p role="alert">
                    {job.unmatchedLineIndexes.length} 句未匹配；未套用部分字幕。
                  </p>
                )}
                {view === "paste" && (
                  <section aria-label="貼入字幕">
                    <h3>貼入字幕</h3>
                    <textarea
                      aria-label="字幕原文或 SRT"
                      value={paste}
                      onChange={(event) => setPaste(event.target.value)}
                    />
                    <button
                      disabled={pending || !paste.trim()}
                      onClick={() =>
                        void perform(async () => {
                          const source = parseSource(paste);
                          setOrigin("paste");
                          setView("processing");
                          await select(source);
                        })
                      }
                    >
                      使用貼入字幕
                    </button>
                    <details open>
                      <summary>確認字幕預覽</summary>
                      <pre>{paste || "貼入後在此確認內容"}</pre>
                    </details>
                  </section>
                )}
                <details>
                  <summary>查看處理詳細資訊</summary>
                  <p>
                    對齊由 lyric-align-ts
                    負責。現階段尚未接入符合契約的發布物與獨立音訊下載來源。
                  </p>
                  <p>語言提示：{work.source?.languageHint ?? "尚未選擇"}</p>
                  <p>{job.error?.code}</p>
                </details>
                {view === "processing" &&
                  job.phase !== "complete" &&
                  job.phase !== "failed" &&
                  job.phase !== "selecting" && (
                    <button onClick={() => void perform(cancel)}>
                      取消處理
                    </button>
                  )}
              </>
            )}
          </>
        )}
        {work?.storageError && (
          <p role="alert" className="subtitle-error">
            {work.storageError}
          </p>
        )}
        {(error || localError) && (
          <p className="subtitle-error" role="alert">
            {localError || error}
          </p>
        )}
      </div>
    </section>
  );
}
