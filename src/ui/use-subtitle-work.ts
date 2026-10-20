import { useEffect, useRef, useState } from "react";
import type {
  AlignmentMode,
  PlayerBinding,
  SubtitleLine,
} from "../shared/types";
import { createProgressiveAudioSource } from "../acoustic/youtube-stream";
import { createLocalModelClient } from "../acoustic/local-model-client";
import { runSubtitleAlignment } from "../acoustic/subtitle-work";
import type { AlignmentProgress } from "../acoustic/alignment-policy";
import { bindPlaybackCoordinator } from "../content/playback-coordinator";
export function useSubtitleWork(
  binding: PlayerBinding,
  publish: (progress: AlignmentProgress) => void,
  notice: (text: string) => void,
) {
  const handlers = useRef({ publish, notice });
  handlers.current = { publish, notice };
  const revision = useRef(0),
    launchRevision = useRef(0),
    active = useRef<
      | {
          controller: AbortController;
          promise: Promise<unknown>;
          playback: ReturnType<typeof bindPlaybackCoordinator>;
        }
      | undefined
    >(undefined);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<AlignmentProgress>();
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      launchRevision.current++;
      active.current?.playback.dispose();
      active.current?.controller.abort();
    };
  }, [binding.videoId]);
  const stop = async () => {
    const work = active.current;
    if (!work) return;
    work.controller.abort();
    await work.promise.catch(() => {});
  };
  const cancel = async () => {
    launchRevision.current++;
    await stop();
  };
  async function start(
    lines: SubtitleLine[],
    mode: AlignmentMode,
    durationMs: number,
  ) {
    const launch = ++launchRevision.current;
    await stop();
    if (!live.current || launch !== launchRevision.current) return;
    const controller = new AbortController(),
      key = {
        runId: crypto.randomUUID(),
        tabId: 0,
        videoId: binding.videoId,
        draftRevision: ++revision.current,
      };
    const playback = bindPlaybackCoordinator(binding.video, (text) =>
      handlers.current.notice(text),
    );
    playback.begin(key, mode);
    const work = {
      controller,
      playback,
      promise: Promise.resolve() as Promise<unknown>,
    };
    active.current = work;
    setBusy(true);
    let latest: AlignmentProgress | undefined;
    const timer = setTimeout(() => {
      handlers.current.notice("本次補時達 10 分鐘上限，已有結果保留");
      controller.abort();
    }, 600000);
    const tick = setInterval(() => {
      if (latest && !binding.isAd()) playback.update(latest);
    }, 250);
    const task = runSubtitleAlignment(
      { key, lines, durationMs, mode, signal: controller.signal },
      {
        model: createLocalModelClient(key, controller.signal),
        positionMs: () => Math.max(0, binding.video.currentTime * 1000),
        source: () =>
          createProgressiveAudioSource(key, durationMs, (text) =>
            handlers.current.notice(text),
          ),
        publish: (progress) => {
          if (!live.current || active.current !== work) return;
          latest = progress;
          setProgress(progress);
          if (!binding.isAd()) playback.update(progress);
          handlers.current.publish(progress);
        },
      },
    );
    work.promise = task;
    try {
      return await task;
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      clearTimeout(timer);
      clearInterval(tick);
      playback.finish();
      playback.dispose();
      if (active.current === work) {
        active.current = undefined;
        if (live.current) setBusy(false);
      }
    }
  }
  return { start, cancel, busy, progress };
}
