import React from "react";
import { createRoot } from "react-dom/client";
import { bindPlayer } from "./player";
import { createOverlay } from "./overlay";
import { Onboarding } from "../ui/Onboarding";
import { followYouTubeTheme } from "./theme";
import { mountWatchPanel } from "./placement";
import { createControlButton } from "./control-button";
import { installAudioTapBridge } from "../youtube/audio-tap-bridge";
import { runAll, watchExtensionContext } from "./orphan";
import css from "../ui/styles.css?inline";
installAudioTapBridge();
let cleanup = () => {};
const stopBinding = bindPlayer((binding) => {
  cleanup();
  cleanup = () => {};
  if (!binding) return;
  const controls = binding.container.querySelector(".ytp-right-controls");
  if (!controls) return;
  const button = createControlButton(controls);
  const host = document.createElement("div");
  host.dataset.aiLyricsPanel = "";
  host.style.cssText = "display:block;width:100%;position:relative;z-index:1";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  const mount = document.createElement("div");
  shadow.append(style, mount);
  const stopPlacement = mountWatchPanel(binding.container, host);
  const overlay = createOverlay(binding);
  const stopTheme = followYouTubeTheme(host);
  const root = createRoot(mount);
  root.render(React.createElement(Onboarding, { binding, overlay, button }));
  cleanup = () =>
    runAll([
      () => root.unmount(),
      stopTheme,
      stopPlacement,
      () => overlay.destroy(),
      () => button.remove(),
      () => host.remove(),
    ]);
});
watchExtensionContext(() => {
  stopBinding();
  cleanup();
});
