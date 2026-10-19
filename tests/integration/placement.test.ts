import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mountWatchPanel } from "../../src/content/placement";
let frames: Map<number, FrameRequestCallback>, nextId: number;
const cleanups: Array<() => void> = [];
beforeEach(() => {
  frames = new Map();
  nextId = 0;
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    frames.set(++nextId, fn);
    return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
const frame = () => {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((fn) => fn(0));
};
const mount = (player: HTMLElement, host: HTMLElement) => {
  const stop = mountWatchPanel(player, host);
  cleanups.push(stop);
  return stop;
};
function fixture() {
  document.body.innerHTML =
    '<div id="movie_player"></div><div id="secondary"><div id="secondary-inner"><div id="related">推薦影片</div></div></div>';
  const player = document.querySelector<HTMLElement>("#movie_player")!;
  player.getBoundingClientRect = () =>
    ({ width: 850, height: 480, x: 20, y: 50 }) as DOMRect;
  const sidebar = document.querySelector<HTMLElement>("#secondary-inner")!;
  sidebar.getBoundingClientRect = () =>
    ({ width: 400, x: 900, y: 50 }) as DOMRect;
  return { player, sidebar, host: document.createElement("div") };
}
it("matches the player height and updates after player resize", () => {
  const callbacks: ResizeObserverCallback[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const { player, host } = fixture();
  mount(player, host);
  frame();
  frame();
  expect(host.style.getPropertyValue("--watch-panel-height")).toBe("480px");
  player.getBoundingClientRect = () =>
    ({ width: 850, height: 560, x: 20, y: 50 }) as DOMRect;
  callbacks.forEach((callback) => callback([], {} as ResizeObserver));
  expect(host.style.getPropertyValue("--watch-panel-height")).toBe("560px");
});
it("does not mount below the video while the final sidebar is missing", () => {
  document.body.innerHTML =
    '<div id="primary-inner"><div id="movie_player"></div><div id="below"></div></div><div id="secondary"></div>';
  const host = document.createElement("div");
  mount(document.querySelector<HTMLElement>("#movie_player")!, host);
  expect(host.isConnected).toBe(false);
  expect(host.style.display).toBe("none");
});
it("waits for stable positive sidebar geometry before revealing at the final position", () => {
  const { player, sidebar, host } = fixture();
  let width = 0;
  sidebar.getBoundingClientRect = () => ({ width, x: 900, y: 50 }) as DOMRect;
  mount(player, host);
  frame();
  expect(host.style.display).toBe("none");
  width = 400;
  sidebar.append(document.createElement("span"));
  return Promise.resolve().then(() => {
    frame();
    expect(host.style.display).toBe("none");
    width = 420;
    frame();
    expect(host.style.display).toBe("none");
    frame();
    expect(host.style.display).toBe("block");
    expect(host.parentElement).toBe(sidebar);
    expect(host.nextElementSibling?.id).toBe("related");
  });
});
it("keeps the same content through late sidebar creation and replacement", async () => {
  document.body.innerHTML = '<div id="movie_player"></div>';
  const host = document.createElement("div");
  host.innerHTML = "<textarea>草稿</textarea>";
  const input = host.querySelector("textarea");
  document.querySelector<HTMLElement>("#movie_player")!.getBoundingClientRect =
    () => ({ width: 850, height: 480, x: 20, y: 50 }) as DOMRect;
  mount(document.querySelector<HTMLElement>("#movie_player")!, host);
  const sidebar = document.createElement("div");
  sidebar.id = "secondary-inner";
  document.body.append(sidebar);
  sidebar.getBoundingClientRect = () =>
    ({ width: 400, x: 900, y: 50 }) as DOMRect;
  await Promise.resolve();
  frame();
  frame();
  expect(host.style.display).toBe("block");
  const next = sidebar.cloneNode(false) as HTMLElement;
  next.getBoundingClientRect = sidebar.getBoundingClientRect;
  sidebar.replaceWith(next);
  await Promise.resolve();
  expect(host.style.display).toBe("none");
  frame();
  frame();
  expect(host.parentElement).toBe(next);
  expect(host.querySelector("textarea")).toBe(input);
  expect(host.style.display).toBe("block");
});
it("does not publish a stable provisional full-width column", async () => {
  const { player, sidebar, host } = fixture();
  sidebar.getBoundingClientRect = () =>
    ({ width: 1300, x: 20, y: 550 }) as DOMRect;
  mount(player, host);
  frame();
  frame();
  frame();
  expect(host.style.display).toBe("none");
  sidebar.getBoundingClientRect = () =>
    ({ width: 400, x: 900, y: 50 }) as DOMRect;
  frame();
  frame();
  expect(host.style.display).toBe("block");
});
it("preserves recommendations and cancels deferred visibility after cleanup", () => {
  const { player, host } = fixture();
  const stop = mount(player, host);
  expect(document.querySelector("#related")?.textContent).toBe("推薦影片");
  stop();
  frame();
  frame();
  expect(host.style.display).toBe("none");
});
