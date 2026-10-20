import type { AlignmentMode } from "../shared/types";
import type { JobKey, TimeRange } from "../acoustic/contracts";
export interface PlaybackPort {
  paused(): boolean;
  positionMs(): number;
  durationMs?(): number;
  pause(): void;
  play(): Promise<void>;
}
export function createPlaybackCoordinator(
  player: PlaybackPort,
  onNotice: (message: string) => void,
) {
  let key: JobKey | undefined,
    mode: AlignmentMode = "background",
    intent = false,
    owned = false,
    disposed = false,
    override = false,
    first = true,
    loading = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const restore = () => {
    if (owned && intent && !disposed) {
      owned = false;
      void player
        .play()
        .catch(() => onNotice("瀏覽器未允許自動播放，請點擊播放"));
    }
  };
  return {
    begin(next: JobKey, nextMode: AlignmentMode) {
      clear();
      key = next;
      mode = nextMode;
      intent = !player.paused();
      owned = false;
      override = false;
      first = true;
      disposed = false;
    },
    update(progress: { key: JobKey; ready: TimeRange[]; phase: string }) {
      if (
        disposed ||
        !key ||
        progress.key.runId !== key.runId ||
        progress.key.draftRevision !== key.draftRevision ||
        mode !== "buffer-before-play"
      )
        return;
      if (
        ["complete", "partial", "failed", "cancelled"].includes(progress.phase)
      ) {
        clear();
        restore();
        return;
      }
      const target = Math.min(
        player.durationMs?.() ?? Infinity,
        player.positionMs() + (first ? 15000 : 3000),
      );
      const ready = progress.ready.some(
        (r) => r.startMs <= player.positionMs() && r.endMs >= target,
      );
      if (ready) {
        clear();
        restore();
        first = false;
        override = false;
        return;
      }
      if (override || !intent) return;
      if (!owned && !player.paused()) {
        owned = true;
        player.pause();
      }
      const nowLoading = progress.phase === "loading";
      if (timer && loading !== nowLoading) clear();
      loading = nowLoading;
      if (owned && !timer)
        timer = setTimeout(
          () => {
            timer = undefined;
            override = true;
            onNotice("等待校時達上限，缺時區段暫無字幕；可重試或切換模式");
            restore();
          },
          nowLoading ? 120000 : 90000,
        );
    },
    userIntent(value: "play" | "pause" | "seek") {
      if (disposed) return;
      if (value === "seek") {
        clear();
        first = true;
        override = false;
        return;
      }
      intent = value === "play";
      owned = false;
      override = value === "play";
      clear();
    },
    finish() {
      clear();
      restore();
    },
    dispose() {
      clear();
      disposed = true;
      owned = false;
    },
  };
}
export function bindPlaybackCoordinator(
  video: HTMLVideoElement,
  onNotice: (text: string) => void,
) {
  let ownPause = 0,
    ownPlay = 0;
  const coordinator = createPlaybackCoordinator(
    {
      paused: () => video.paused,
      positionMs: () => video.currentTime * 1000,
      durationMs: () => video.duration * 1000,
      pause: () => {
        if (!video.paused) {
          ownPause++;
          video.pause();
        }
      },
      play: async () => {
        if (video.paused) {
          ownPlay++;
          try {
            await video.play();
          } catch (e) {
            ownPlay = Math.max(0, ownPlay - 1);
            throw e;
          }
        }
      },
    },
    onNotice,
  );
  const pause = () => {
    if (ownPause) ownPause--;
    else coordinator.userIntent("pause");
  };
  const play = () => {
    if (ownPlay) ownPlay--;
    else coordinator.userIntent("play");
  };
  const seek = () => coordinator.userIntent("seek");
  video.addEventListener("pause", pause);
  video.addEventListener("play", play);
  video.addEventListener("seeking", seek);
  const click = (event: Event) => {
    const target = event.target;
    if (
      target instanceof Element &&
      (target.closest(".ytp-play-button") || target === video)
    )
      coordinator.userIntent(video.paused ? "play" : "pause");
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === "MediaPause" || event.key === "MediaStop") {
      coordinator.userIntent("pause");
      return;
    }
    if (event.key === "MediaPlay") {
      coordinator.userIntent("play");
      return;
    }
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("input,textarea,[contenteditable=true]")
    )
      return;
    if ([" ", "k", "K", "MediaPlayPause"].includes(event.key))
      coordinator.userIntent(video.paused ? "play" : "pause");
  };
  document.addEventListener("click", click, true);
  document.addEventListener("keydown", key, true);
  return {
    ...coordinator,
    dispose() {
      coordinator.dispose();
      video.removeEventListener("pause", pause);
      video.removeEventListener("play", play);
      video.removeEventListener("seeking", seek);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
    },
  };
}
