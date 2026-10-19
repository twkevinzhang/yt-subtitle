export function followYouTubeTheme(host: HTMLElement) {
  const update = () => {
    host.dataset.theme = document.documentElement.hasAttribute("dark")
      ? "dark"
      : "light";
  };
  update();
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["dark"],
  });
  return () => observer.disconnect();
}
