import type {
  AlignedLine,
  SavedResult,
  DisplayMode,
  PlayerBinding,
  Preferences,
} from "../shared/types";
import { validateTiming } from "../lyrics/formats";
import {
  assertJobKey,
  type AlignmentSnapshot,
  type JobKey,
} from "../acoustic/contracts";
export function activeLines(
  lines: AlignedLine[],
  timeMs: number,
  offsetMs: number,
) {
  return lines.filter(
    (l) =>
      !l.excluded &&
      l.startMs !== undefined &&
      l.endMs !== undefined &&
      timeMs >= l.startMs + offsetMs &&
      timeMs < l.endMs + offsetMs,
  );
}
export function createOverlay(binding: PlayerBinding) {
  const host = document.createElement("div");
  host.dataset.aiLyricsOverlay = "";
  const shadow = host.attachShadow({ mode: "closed" });
  const display = document.createElement("div");
  host.style.cssText =
    "position:absolute;inset:0;pointer-events:none;z-index:45";
  display.style.cssText =
    'position:absolute;left:5%;width:90%;bottom:12%;text-align:center;color:white;white-space:pre-line;font-family:Arial,"Noto Sans CJK TC",sans-serif;line-height:1.45;text-shadow:0 2px 4px #000,0 0 8px #000;font-weight:600';
  shadow.append(display);
  binding.container.append(host);
  let result: SavedResult | undefined,
    mode: DisplayMode = "original",
    frame = 0;
  let draftKey: JobKey | undefined,
    preview: AlignedLine[] | undefined,
    previewSequence = -1;
  const render = () => {
    if (!host.isConnected || !binding.video.isConnected) return;
    const lines =
      (preview || result) && !binding.isAd()
        ? activeLines(
            preview ?? result!.lines,
            binding.video.currentTime * 1000,
            preview ? 0 : result!.offsetMs,
          )
        : [];
    display.textContent = lines
      .map((l) =>
        mode === "original"
          ? l.original
          : mode === "translation"
            ? l.translation || ""
            : `${l.original}\n${l.translation || ""}`,
      )
      .join("\n");
    frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);
  return {
    beginDraft(key: JobKey) {
      if (key.videoId !== binding.videoId) throw new Error("影片已切換");
      draftKey = { ...key };
      preview = undefined;
      previewSequence = -1;
    },
    setDraftPreview(
      snapshot: AlignmentSnapshot,
      newMode: DisplayMode,
      preferences?: Preferences,
    ) {
      if (!draftKey) throw new Error("尚未開始草稿預覽");
      assertJobKey(draftKey, snapshot.key);
      if (
        !Number.isSafeInteger(snapshot.sequence) ||
        snapshot.sequence <= previewSequence
      )
        return;
      const timed = snapshot.lines.filter(
        (l) => !l.excluded && l.startMs !== undefined && l.endMs !== undefined,
      );
      if (!timed.length) return;
      if (
        new Set(timed.map((l) => l.id)).size !== timed.length ||
        validateTiming(timed, binding.video.duration * 1000, 0).some(
          (i) => i.severity === "error",
        )
      )
        throw new Error("草稿時間無效");
      preview = structuredClone(
        timed.filter((l) => newMode === "original" || !!l.translation),
      );
      previewSequence = snapshot.sequence;
      mode = newMode;
      if (preferences) {
        display.style.fontSize = preferences.fontSize + "px";
        display.style.top = preferences.position === "top" ? "10%" : "";
        display.style.bottom = preferences.position === "bottom" ? "12%" : "";
      }
    },
    setResult(
      value: SavedResult,
      newMode: DisplayMode,
      preferences?: Preferences,
    ) {
      if (
        validateTiming(value.lines, value.videoDurationMs, value.offsetMs).some(
          (i) => i.severity === "error",
        )
      )
        throw new Error("請先校正或排除未對齊句子");
      if (
        newMode !== "original" &&
        value.lines.some((l) => !l.excluded && !l.translation)
      )
        throw new Error("譯文尚未完整");
      result = value;
      draftKey = undefined;
      preview = undefined;
      previewSequence = -1;
      mode = newMode;
      if (preferences) {
        display.style.fontSize = preferences.fontSize + "px";
        display.style.top = preferences.position === "top" ? "10%" : "";
        display.style.bottom = preferences.position === "bottom" ? "12%" : "";
      }
    },
    stop() {
      result = undefined;
      draftKey = undefined;
      preview = undefined;
      previewSequence = -1;
      display.textContent = "";
    },
    destroy() {
      cancelAnimationFrame(frame);
      host.remove();
    },
  };
}
