// Serialized by chrome.scripting: keep these functions self-contained, no secrets or imports.
export function inspectPage() {
  const id = new URL(location.href).searchParams.get("v");
  if (!id || location.pathname !== "/watch")
    throw new Error("僅支援一般 watch 影片");
  const p = document.querySelector("#movie_player") as any,
    w = window as any;
  const response = p?.getPlayerResponse?.() || w.ytInitialPlayerResponse;
  if (response?.videoDetails?.videoId && response.videoDetails.videoId !== id)
    throw new Error("影片正在切換，請稍後重試");
  const active = p?.getAudioTrack?.()?.captionTracks;
  const tracks =
    Array.isArray(active) && active.length
      ? active
      : response?.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
        [];
  const video = document.querySelector("video");
  return {
    video: {
      schemaVersion: 1,
      videoId: id,
      title: String(
        p?.getVideoData?.()?.title ||
          response?.videoDetails?.title ||
          document.querySelector("h1.ytd-watch-metadata")?.textContent ||
          document.title,
      ).slice(0, 2000),
      channel: String(
        response?.videoDetails?.author ||
          document.querySelector("#owner #channel-name")?.textContent ||
          "",
      ).slice(0, 1000),
      description: String(response?.videoDetails?.shortDescription || "").slice(
        0,
        20000,
      ),
      durationMs: Math.round(
        Number(video?.duration || response?.videoDetails?.lengthSeconds || 0) *
          1000,
      ),
    },
    tracks: tracks
      .map((t: any, i: number) => ({
        schemaVersion: 1,
        id: String(i),
        language: t.languageCode || "",
        label:
          t.name?.simpleText ||
          t.name?.runs?.map((x: any) => x.text).join("") ||
          t.displayName ||
          t.languageCode,
        isAuto: t.kind === "asr" || String(t.vssId || "").startsWith("a."),
        isTranslated: new URL(
          t.url || t.baseUrl,
          location.href,
        ).searchParams.has("tlang"),
        url: t.url || t.baseUrl,
      }))
      .slice(0, 100),
  };
}
export async function readCaptionPage(trackId: string, expectedId: string) {
  if (new URL(location.href).searchParams.get("v") !== expectedId)
    throw new Error("影片已切換");
  const p = document.querySelector("#movie_player") as any,
    w = window as any,
    r = p?.getPlayerResponse?.() || w.ytInitialPlayerResponse;
  if (r?.videoDetails?.videoId && r.videoDetails.videoId !== expectedId)
    throw new Error("影片已切換");
  const active = p?.getAudioTrack?.()?.captionTracks;
  const tracks =
    Array.isArray(active) && active.length
      ? active
      : r?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const track = tracks[Number(trackId)];
  if (!track || String(Number(trackId)) !== trackId)
    throw new Error("字幕軌不存在");
  const url = new URL(track.url || track.baseUrl, location.href);
  if (
    url.protocol !== "https:" ||
    !["www.youtube.com", "www.youtube-nocookie.com"].includes(url.hostname) ||
    url.pathname !== "/api/timedtext" ||
    url.username ||
    url.password
  )
    throw new Error("字幕網址不合法");
  if (url.searchParams.get("v") && url.searchParams.get("v") !== expectedId)
    throw new Error("字幕屬於其他影片");
  url.searchParams.set("fmt", "json3");
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url.href, {
      credentials: "same-origin",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`字幕 HTTP ${response.status}`);
    const reader = response.body?.getReader();
    let size = 0,
      text = "";
    const decoder = new TextDecoder();
    if (!reader) throw new Error("字幕內容為空");
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 4194304) {
        await reader.cancel();
        throw new Error("字幕內容過大");
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    if (new URL(location.href).searchParams.get("v") !== expectedId)
      throw new Error("影片已切換");
    return { raw: text, format: "json3" as const };
  } finally {
    clearTimeout(timer);
  }
}
