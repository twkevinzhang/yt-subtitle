import React, { useState, useEffect, useRef } from "react";
import type {
  PlayerBinding,
  PublicSettings,
  LyricCandidate,
} from "../shared/types";
import type { createOverlay } from "../content/overlay";
import { request } from "../shared/messages";
import { useSubtitleWork } from "./use-subtitle-work";
import { ProgressSteps, StepIcon, stationsFor } from "./ProgressSteps";
import { TranslateDialog, type TranslateChoice } from "./TranslateDialog";
import {
  DEFAULT_TRANSLATION,
  decideTranslation,
  userLanguage,
  type TranslationLanguage,
} from "../shared/translation";
import type { SelectedSource } from "../subtitle/types";
import { AiResults } from "./AiResults";
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
    [paste, setPaste] = useState(""),
    [asking, setAsking] = useState<{
      source: SelectedSource;
      language: TranslationLanguage;
    }>();
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
        publicSettings?.preferences.position +
        ":" +
        work.translation?.phase +
        ":" +
        publicSettings?.preferences.translation?.display;
      if (id !== published.current) {
        const lines = new Map(
          work.translation?.phase === "done"
            ? work.translation.lines?.map((l) => [l.index, l.text])
            : [],
        );
        overlay.setCues(
          work.cues.map((c) =>
            lines.has(c.sourceLineIndex)
              ? { ...c, translation: lines.get(c.sourceLineIndex) }
              : c,
          ),
          publicSettings?.preferences,
        );
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
  const begin = async (
    source: SelectedSource,
    translate?: TranslationLanguage,
  ) => {
    setOrigin("ai");
    setView("processing");
    await select(source, translate);
  };
  const useSelected = () =>
    perform(async () => {
      if (!selected) throw Error("請先選擇字幕");
      const source = parseSource(
        selected.candidate.syncedLyrics ?? selected.candidate.fullText ?? "",
        selected.candidate.language,
      );
      const decision = decideTranslation(
        publicSettings?.preferences.translation,
        selected.candidate.language,
      );
      if (decision.kind === "ask")
        setAsking({ source, language: decision.language });
      else
        await begin(
          source,
          decision.kind === "run" ? decision.language : undefined,
        );
    });
  const answerTranslation = ({ translate, save }: TranslateChoice) =>
    perform(async () => {
      if (!asking) return;
      if (save)
        await request({
          type: "translation-save",
          translation: {
            ...DEFAULT_TRANSLATION,
            ...publicSettings?.preferences.translation,
            ...save,
          },
        });
      const { source } = asking;
      setAsking(undefined);
      await begin(source, translate);
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
    // Picking a result needs the room; the hint line is dropped then.
    choosing = view === "ai" && job?.phase !== "searching",
    stations = job ? stationsFor(job, work?.translation) : [];
  return (
    <section className="subtitle-panel" aria-label="AI 歌詞">
      <header className="subtitle-header">
        <div className="subtitle-heading">
          {view !== "method" && (
            <button
              className="subtitle-back"
              aria-label="上一步"
              title="上一步"
              onClick={() => void goBack()}
              disabled={pending && view !== "processing"}
            >
              ‹
            </button>
          )}
          <div className="subtitle-titles">
            <strong>AI 歌詞</strong>
            <small
              className="subtitle-video-title"
              title={work?.video.title ?? undefined}
            >
              <span
                className="subtitle-playing"
                role="img"
                aria-label="影片持續播放"
                title="影片持續播放"
              >
                ▶
              </span>{" "}
              {work?.video.title ?? "字幕工作台"}
            </small>
          </div>
        </div>
        <nav aria-label="面板操作">
          <button
            disabled={pending}
            onClick={() => {
              if (
                window.confirm(
                  "重新載入會清除這首歌的本機資料（音訊與對齊結果）並重新搜尋，確定繼續？",
                )
              )
                void perform(async () => {
                  await reset(true);
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
                <div
                  className={
                    "subtitle-hero" + (choosing ? " subtitle-hero-compact" : "")
                  }
                >
                  <h3 role="status" aria-live="polite">
                    {view === "paste"
                      ? "貼入字幕"
                      : view === "ai" && job.phase !== "searching"
                        ? "選擇一份字幕"
                        : phaseTitles[job.phase]}
                  </h3>
                  {!choosing && (
                    <p>
                      {job.phase === "complete"
                        ? "完整字幕已顯示在影片中。"
                        : "整首完成後才套用，處理期間不影響影片播放。"}
                    </p>
                  )}
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
                      translation={
                        view === "ai" ? undefined : work?.translation
                      }
                    />
                  )}
                </div>
                {work.cues && job.phase !== "complete" && (
                  <p className="subtitle-play">目前顯示先前已完成的字幕。</p>
                )}
                {(view === "processing" || view === "result") && (
                  <div>
                    {stations.slice(1).map((step) => (
                      <div className="subtitle-row" key={step.id}>
                        <span>
                          <StepIcon index={step.icon} />
                          {step.label}
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
                  <AiResults
                    search={work.search}
                    searching={job.phase === "searching"}
                    selected={selected}
                    pending={pending}
                    onSelect={setSelected}
                    onUseSelected={() => void useSelected()}
                    onSearchAgain={() => void perform(() => reset())}
                    onPaste={() => void chooseMode("paste")}
                  />
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
                {work.translation?.phase === "failed" && view !== "ai" && (
                  <p className="subtitle-error" role="alert">
                    翻譯失敗：{work.translation.error}
                  </p>
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
        {asking && (
          <TranslateDialog
            own={userLanguage()}
            initial={asking.language}
            busy={pending}
            onCancel={() => setAsking(undefined)}
            onChoose={(choice) => void answerTranslation(choice)}
          />
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
