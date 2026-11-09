import { useEffect, useState, useCallback } from "react";
import { request } from "../shared/messages";
import type { VideoWork } from "../subtitle/coordinator";
import type { SelectedSource } from "../subtitle/types";
export function useSubtitleWork(videoId: string) {
  const [work, setWork] = useState<VideoWork>(),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true,
      busy = false;
    const update = async () => {
      if (busy) return;
      busy = true;
      try {
        const state = await request<VideoWork | null>({
          type: "subtitle-snapshot",
        });
        if (live && state?.video.videoId === videoId) {
          setWork(state);
          setError("");
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "無法讀取狀態");
      } finally {
        busy = false;
      }
    };
    void update();
    const timer = setInterval(update, 700);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [videoId]);
  const select = useCallback(
    async (source: SelectedSource) => {
      const next = await request<VideoWork>({
        type: "subtitle-select",
        source,
      });
      if (next.video.videoId === videoId) setWork(next);
    },
    [videoId],
  );
  const reset = async (clearLocalData = false) => {
    setWork(
      await request<VideoWork>({
        type: "subtitle-reset",
        ...(clearLocalData ? { clearLocalData } : {}),
      }),
    );
  };
  const cancel = async () => {
    const next = await request<VideoWork>({ type: "subtitle-cancel" });
    setWork(next);
  };
  const setEntryMode = async (mode: "ai" | "paste") => {
    setWork(await request<VideoWork>({ type: "subtitle-entry-mode", mode }));
  };
  return { work, error, select, reset, cancel, setEntryMode };
}
