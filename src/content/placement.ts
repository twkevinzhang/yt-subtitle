// YouTube positions its recommendation column below a theater player and beside
// a standard player. Docking there lets its own layout handle both modes.
export function mountWatchPanel(player: HTMLElement, host: HTMLElement) {
  const place = () => {
    if (!player.isConnected) return;
    const sidebar =
      document.querySelector("#secondary-inner") ||
      document.querySelector("#secondary");
    if (sidebar) {
      host.dataset.dock = "sidebar";
      host.style.maxWidth = "";
      host.style.marginInline = "";
      if (host.parentElement !== sidebar || sidebar.firstElementChild !== host)
        sidebar.prepend(host);
      return;
    }
    // While the column is being rebuilt, keep the same mounted React tree.
    host.dataset.dock = "below";
    const below = document.querySelector("#primary-inner #below");
    if (below?.parentNode) {
      host.style.maxWidth = "";
      if (host.nextSibling !== below)
        below.parentNode.insertBefore(host, below);
    } else if (player.parentNode) {
      const width = player.getBoundingClientRect().width;
      if (width > 0) host.style.maxWidth = `${width}px`;
      host.style.marginInline = "auto";
      if (player.nextSibling !== host)
        player.parentNode.insertBefore(host, player.nextSibling);
    }
  };
  place();
  const observer = new MutationObserver(place);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  const resize =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(place);
  resize?.observe(player);
  return () => {
    observer.disconnect();
    resize?.disconnect();
  };
}
