import type {
  AlignedLine,
  SavedResult,
  DisplayMode,
  PlayerBinding,
  Preferences,
} from "../shared/types";
import { validateTiming } from "../lyrics/formats";
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
  const render = () => {
    if (!host.isConnected || !binding.video.isConnected) return;
    const lines =
      result && !binding.isAd()
        ? activeLines(
            result.lines,
            binding.video.currentTime * 1000,
            result.offsetMs,
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
      mode = newMode;
      if (preferences) {
        display.style.fontSize = preferences.fontSize + "px";
        display.style.top = preferences.position === "top" ? "10%" : "";
        display.style.bottom = preferences.position === "bottom" ? "12%" : "";
      }
    },
    stop() {
      result = undefined;
      display.textContent = "";
    },
    destroy() {
      cancelAnimationFrame(frame);
      host.remove();
    },
  };
}
