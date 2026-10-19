// YouTube moves the player outside the primary column in theater mode.
// The metadata anchor remains below it in both watch layouts.
export function mountBelowPlayer(player: HTMLElement, host: HTMLElement) {
  const place = () => {
    if (!player.isConnected) return;
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
