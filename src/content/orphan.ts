/**
 * After the extension is reloaded or updated, scripts already injected into
 * open pages lose their connection to it but keep running. They would leave
 * a stale panel and subtitles on screen, so they remove themselves instead.
 */
export function extensionAlive() {
  try {
    return typeof chrome !== "undefined" && !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

export function watchExtensionContext(
  onLost: () => void,
  options: {
    alive?: () => boolean;
    intervalMs?: number;
  } = {},
) {
  const alive = options.alive ?? extensionAlive;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  timer = setInterval(() => {
    if (alive()) return;
    stop();
    onLost();
  }, options.intervalMs ?? 2000);
  return stop;
}

/** Runs every step even when an earlier one throws, so nothing is left behind. */
export function runAll(steps: ReadonlyArray<() => void>) {
  for (const step of steps) {
    try {
      step();
    } catch {
      // A failing step must not keep the later ones from removing their UI.
    }
  }
}
