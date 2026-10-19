import { afterEach, expect, it } from "vitest";
import { mountWatchPanel } from "../../src/content/placement";
afterEach(() => {
  document.body.innerHTML = "";
});
it("mounts below the video before metadata without covering the player", () => {
  document.body.innerHTML =
    '<div id="primary-inner"><div id="player"><div id="movie_player"></div></div><div id="below">metadata</div></div>';
  const player = document.querySelector<HTMLElement>("#movie_player")!;
  const host = document.createElement("div");
  const stop = mountWatchPanel(player, host);
  expect(host.nextElementSibling?.id).toBe("below");
  expect(player.contains(host)).toBe(false);
  stop();
});
it("prefers the recommendation sidebar and preserves its existing content", () => {
  document.body.innerHTML =
    '<div id="primary-inner"><div id="movie_player"></div><div id="below"></div></div><div id="secondary"><div id="secondary-inner"><div id="related">推薦影片</div></div></div>';
  const player = document.querySelector<HTMLElement>("#movie_player")!;
  const host = document.createElement("div");
  const stop = mountWatchPanel(player, host);
  expect(host.parentElement?.id).toBe("secondary-inner");
  expect(host.nextElementSibling?.id).toBe("related");
  expect(document.querySelector("#related")?.textContent).toBe("推薦影片");
  expect(host.dataset.dock).toBe("sidebar");
  stop();
});
it("moves the existing panel to a late or replaced sidebar without losing state", async () => {
  document.body.innerHTML = '<div id="movie_player"></div>';
  const host = document.createElement("div");
  host.innerHTML = "<textarea>草稿</textarea>";
  const input = host.querySelector("textarea");
  const stop = mountWatchPanel(
    document.querySelector<HTMLElement>("#movie_player")!,
    host,
  );
  const sidebar = document.createElement("div");
  sidebar.id = "secondary-inner";
  document.body.append(sidebar);
  await new Promise((r) => setTimeout(r, 0));
  expect(host.parentElement).toBe(sidebar);
  const next = sidebar.cloneNode(false);
  sidebar.replaceWith(next);
  await new Promise((r) => setTimeout(r, 0));
  expect(host.parentNode).toBe(next);
  expect(host.querySelector("textarea")).toBe(input);
  stop();
});
it("keeps fallback panel no wider than its player", () => {
  const player = document.createElement("div");
  document.body.append(player);
  player.getBoundingClientRect = () => ({ width: 1100 }) as DOMRect;
  const host = document.createElement("div");
  const stop = mountWatchPanel(player, host);
  expect(host.style.maxWidth).toBe("1100px");
  stop();
});
it("reattaches after YouTube rebuilds metadata and supports theater layout", async () => {
  document.body.innerHTML =
    '<div id="full-bleed-container"><div id="movie_player"></div></div><div id="primary-inner"><div id="below"></div></div>';
  const host = document.createElement("div");
  const stop = mountWatchPanel(
    document.querySelector<HTMLElement>("#movie_player")!,
    host,
  );
  host.remove();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(host.nextElementSibling?.id).toBe("below");
  stop();
  host.remove();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(host.isConnected).toBe(false);
});
