import { inspectPage, readCaptionPage, readTranscriptPage } from "./bridge";
import { videoSchema } from "../shared/schemas";
import { parseYouTubeCaptions } from "./captions";
import type { CaptionTrack, Cue, VideoContext } from "../shared/types";
import { manualTracks } from "./manual-tracks";
export async function readManualTrack(
  tabId: number,
  trackId: string,
  videoId: string,
): Promise<Cue[]> {
  const context = await inspectVideo(tabId);
  if (
    context.video.videoId !== videoId ||
    !manualTracks(context.tracks).some((t) => t.id === trackId)
  )
    throw new Error("不是可用的人工字幕軌");
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: readCaptionPage,
    args: [trackId, videoId],
  });
  if (!r?.result) throw new Error("人工字幕讀取失敗，請重新讀取");
  const cues = parseYouTubeCaptions(r.result.raw, r.result.format);
  if (!cues.length) throw new Error("人工字幕內容為空");
  return cues;
}
export async function readTranscript(
  tabId: number,
  videoId: string,
): Promise<Cue[]> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: readTranscriptPage,
    args: [videoId],
  });
  if (!result?.result?.length) throw new Error("未取得 YouTube 轉錄稿");
  return result.result;
}
export function validateCaptionUrl(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    !["www.youtube.com", "www.youtube-nocookie.com"].includes(u.hostname) ||
    u.pathname !== "/api/timedtext" ||
    u.username ||
    u.password
  )
    throw new Error("字幕網址不合法");
  return u.href;
}
export function chooseTracks(tracks: CaptionTrack[]) {
  return [...tracks].sort(
    (a, b) =>
      Number(a.isTranslated) - Number(b.isTranslated) ||
      Number(a.isAuto) - Number(b.isAuto),
  );
}
export async function inspectVideo(tabId: number): Promise<{
  video: VideoContext;
  tracks: CaptionTrack[];
  selectedTrackId?: string;
}> {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: inspectPage,
  });
  if (!r?.result) throw new Error("無法讀取播放器");
  const data = r.result;
  return {
    selectedTrackId:
      typeof data.selectedTrackId === "string"
        ? data.selectedTrackId
        : undefined,
    video: videoSchema.parse(data.video),
    tracks: chooseTracks(
      data.tracks.filter((t: any) => {
        try {
          validateCaptionUrl(t.url);
          return typeof t.id === "string" && typeof t.language === "string";
        } catch {
          return false;
        }
      }),
    ),
  };
}
export async function readTrack(
  tabId: number,
  trackId: string,
  videoId: string,
): Promise<Cue[]> {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: readCaptionPage,
      args: [trackId, videoId],
    });
    if (!r?.result) throw new Error("字幕讀取失敗，請啟用原生字幕後重試");
    return parseYouTubeCaptions(r.result.raw, r.result.format);
  } catch {
    return readTranscript(tabId, videoId);
  }
}
