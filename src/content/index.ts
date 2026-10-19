import React from "react";
import { createRoot } from "react-dom/client";
import { bindPlayer } from "./player";
import { createOverlay } from "./overlay";
import { Panel } from "../ui/Panel";
import css from "../ui/styles.css?inline";
let cleanup = () => {};
bindPlayer((binding) => {
  cleanup();
  cleanup = () => {};
  if (!binding) return;
  const controls = binding.container.querySelector(".ytp-right-controls");
  if (!controls) return;
  const button = document.createElement("button");
  button.className = "ytp-button";
  button.textContent = "AI";
  button.title = "AI 歌詞";
  button.setAttribute("aria-label", "AI 歌詞");
  button.style.cssText = "font:bold 15px Arial;vertical-align:top";
  button.dataset.aiLyricsButton = "";
  controls.prepend(button);
  const host = document.createElement("div");
  host.style.cssText =
    "position:absolute;inset:0;pointer-events:none;z-index:60";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  const mount = document.createElement("div");
  shadow.append(style, mount);
  binding.container.append(host);
  const overlay = createOverlay(binding);
  let root: ReturnType<typeof createRoot> | undefined,
    visible = false;
  const close = () => {
    visible = false;
    mount.style.display = "none";
  };
  button.onclick = () => {
    if (!root) {
      root = createRoot(mount);
      root.render(
        React.createElement(Panel, { binding, overlay, onClose: close }),
      );
    }
    visible = !visible;
    mount.style.display = visible ? "block" : "none";
  };
  cleanup = () => {
    root?.unmount();
    overlay.destroy();
    button.remove();
    host.remove();
  };
});
