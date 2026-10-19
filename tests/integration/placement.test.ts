import { afterEach, expect, it } from "vitest";
import { mountBelowPlayer } from "../../src/content/placement";
afterEach(() => {
  document.body.innerHTML = "";
});
it("mounts below the video before metadata without covering the player", () => {
  document.body.innerHTML =
    '<div id="primary-inner"><div id="player"><div id="movie_player"></div></div><div id="below">metadata</div></div>';
  const player = document.querySelector<HTMLElement>("#movie_player")!;
  const host = document.createElement("div");
  const stop = mountBelowPlayer(player, host);
  expect(host.nextElementSibling?.id).toBe("below");
  expect(player.contains(host)).toBe(false);
  stop();
});
it("keeps fallback panel no wider than its player", () => {
  const player = document.createElement("div");
  document.body.append(player);
  player.getBoundingClientRect = () => ({ width: 1100 }) as DOMRect;
  const host = document.createElement("div");
  const stop = mountBelowPlayer(player, host);
  expect(host.style.maxWidth).toBe("1100px");
  stop();
});
it("reattaches after YouTube rebuilds metadata and supports theater layout", async () => {
  document.body.innerHTML =
    '<div id="full-bleed-container"><div id="movie_player"></div></div><div id="primary-inner"><div id="below"></div></div>';
  const host = document.createElement("div");
  const stop = mountBelowPlayer(
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
