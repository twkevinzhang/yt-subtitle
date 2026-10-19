// Do not publish at a provisional full-width anchor: wait for the final column.
export function mountWatchPanel(player: HTMLElement, host: HTMLElement) {
  let sidebar: HTMLElement | null = null;
  let frame = 0,
    stopped = false,
    published = false;
  let sample: { width: number; x: number; y: number } | undefined;
  host.style.display = "none";
  host.dataset.dock = "sidebar";
  const syncHeight = () => {
    if (!sidebar || !player.isConnected) return;
    const video = player.getBoundingClientRect();
    const column = sidebar.getBoundingClientRect();
    if (
      video.height > 0 &&
      column.x >= video.x + video.width - 1 &&
      column.y < video.y + video.height - 1
    )
      host.style.setProperty("--watch-panel-height", `${video.height}px`);
    else host.style.removeProperty("--watch-panel-height");
  };
  const schedule = () => {
    if (!stopped && !frame && !published && sidebar)
      frame = requestAnimationFrame(checkGeometry);
  };
  const checkGeometry = () => {
    frame = 0;
    if (stopped || !sidebar?.isConnected || !player.isConnected) return;
    const rect = sidebar.getBoundingClientRect();
    const video = player.getBoundingClientRect();
    syncHeight();
    const beside = rect.x >= video.x + video.width - 1;
    const belowRight =
      rect.y >= video.y + video.height - 1 &&
      rect.x >= video.x + video.width / 2;
    if (rect.width <= 0 || video.width <= 0 || !(beside || belowRight)) {
      sample = undefined;
      schedule();
      return;
    }
    if (
      sample &&
      Math.abs(rect.width - sample.width) < 0.5 &&
      Math.abs(rect.x - sample.x) < 0.5 &&
      Math.abs(rect.y - sample.y) < 0.5
    ) {
      published = true;
      host.style.display = "block";
    } else {
      sample = { width: rect.width, x: rect.x, y: rect.y };
      schedule();
    }
  };
  const resize =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(() => {
          syncHeight();
          schedule();
        });
  resize?.observe(player);
  const place = () => {
    if (stopped) return;
    const next = player.isConnected
      ? document.querySelector<HTMLElement>("#secondary-inner")
      : null;
    if (next !== sidebar) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      sample = undefined;
      published = false;
      host.style.display = "none";
      if (sidebar) resize?.unobserve(sidebar);
      sidebar = next;
      if (sidebar) resize?.observe(sidebar);
    }
    if (!sidebar) return;
    syncHeight();
    if (host.parentElement !== sidebar || sidebar.firstElementChild !== host)
      sidebar.prepend(host);
    schedule();
  };
  const observer = new MutationObserver(place);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["id"],
  });
  place();
  return () => {
    stopped = true;
    if (frame) cancelAnimationFrame(frame);
    observer.disconnect();
    resize?.disconnect();
  };
}
