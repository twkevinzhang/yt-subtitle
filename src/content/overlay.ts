import type { PlayerBinding, Preferences } from "../shared/types";
import type { PlayableCue } from "../subtitle/types";
export function createOverlay(binding: PlayerBinding) {
  const host = document.createElement("div");
  host.dataset.aiLyricsOverlay = "";
  host.style.cssText =
    "position:absolute;inset:0;pointer-events:none;z-index:45";
  const shadow = host.attachShadow({ mode: "closed" }),
    display = document.createElement("div");
  display.style.cssText =
    "position:absolute;left:5%;width:90%;bottom:12%;text-align:center;color:white;white-space:pre-line;font:600 28px/1.45 sans-serif;text-shadow:0 2px 4px #000,0 0 8px #000";
  shadow.append(display);
  binding.container.append(host);
  let cues: readonly PlayableCue[] = [],
    frame = 0;
  const render = () => {
    const time = binding.video.currentTime * 1000;
    display.textContent = binding.isAd()
      ? ""
      : cues
          .filter((c) => time >= c.startMs && time < c.endMs)
          .map((c) => c.text)
          .join("\n");
    frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);
  return {
    setCues(value: readonly PlayableCue[], preferences?: Preferences) {
      cues = value;
      if (preferences) {
        display.style.fontSize = preferences.fontSize + "px";
        display.style.top = preferences.position === "top" ? "10%" : "";
        display.style.bottom = preferences.position === "bottom" ? "12%" : "";
      }
    },
    stop() {
      cues = [];
      display.textContent = "";
    },
    destroy() {
      cancelAnimationFrame(frame);
      host.remove();
    },
  };
}
