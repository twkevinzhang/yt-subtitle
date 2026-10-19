// Modern YouTube nests its controls in groups; older players use the row itself.
export function createControlButton(controls: Element) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ytp-button";
  button.title = "AI 歌詞";
  button.setAttribute("aria-label", "AI 歌詞");
  button.dataset.aiLyricsButton = "";
  // Use the same scalable icon box as native controls instead of a text baseline.
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 36 36");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("aria-hidden", "true");
  svg.style.display = "block";
  // YouTube adds padding to SVGs. Include it inside the button-sized icon box.
  svg.style.boxSizing = "border-box";
  const text = document.createElementNS(svg.namespaceURI, "text");
  text.setAttribute("x", "18");
  text.setAttribute("y", "18");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "central");
  text.setAttribute("fill", "currentColor");
  text.setAttribute("font-family", "Arial, sans-serif");
  text.setAttribute("font-size", "18");
  text.setAttribute("font-weight", "700");
  text.textContent = "AI";
  svg.append(text);
  button.append(svg);
  (controls.querySelector(".ytp-right-controls-left") || controls).prepend(
    button,
  );
  return button;
}
