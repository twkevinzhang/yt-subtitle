import { MAX_AUDIO_BYTES } from "./contracts";
import { request } from "../shared/messages";

export async function acquireYouTubeAudio(
  videoId: string,
  durationMs: number,
  signal: AbortSignal,
  progress: (text: string) => void,
): Promise<string> {
  if (
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    durationMs * 64 > MAX_AUDIO_BYTES
  )
    throw new Error("目前只支援可完整解碼於 64 MiB 內的影片");
  if (signal.aborted) throw new Error("工作已取消");
  const assetId = await request<string>({ type: "audio-begin" });
  try {
    if (signal.aborted) throw new Error("工作已取消");
    const nonce = crypto.randomUUID(),
      frame = document.createElement("iframe");
    frame.src = `https://www.youtube.com/watch?v=${videoId}&ai-lyrics-audio=${nonce}&autoplay=1&mute=1`;
    frame.allow = "autoplay";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText =
      "position:fixed;top:0;left:0;width:480px;height:270px;opacity:0;pointer-events:none;z-index:-1";
    const chunks: Uint8Array[] = [];
    let bytes = 0,
      resets = 0;
    const compressed = await new Promise<Uint8Array>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        window.removeEventListener("message", listener);
        signal.removeEventListener("abort", cancel);
        frame.remove();
      };
      const fail = (message: string) => {
        cleanup();
        reject(new Error(message));
      };
      const cancel = () => fail("工作已取消");
      const timer = setTimeout(
        () => fail("音訊擷取達 90 秒上限，歌詞已保留"),
        90000,
      );
      const listener = (event: MessageEvent) => {
        if (
          event.source !== frame.contentWindow ||
          event.origin !== "https://www.youtube.com" ||
          event.data?.tag !== "ai-lyrics-audio" ||
          event.data.nonce !== nonce
        )
          return;
        const m = event.data;
        if (m.type === "reset") {
          if (++resets > 2) {
            fail("音訊來源持續切換，歌詞已保留");
            return;
          }
          bytes = 0;
          chunks.length = 0;
          progress("音訊來源已更換，正在重新讀取完整音訊…");
          return;
        }
        if (m.type === "error") {
          fail(String(m.message));
          return;
        }
        if (m.type === "coverage") {
          progress(
            `正在讀取影片音訊 ${Math.floor(m.edge)}／${Math.ceil(durationMs / 1000)} 秒…`,
          );
          return;
        }
        if (m.type === "chunk") {
          if (!(m.data instanceof ArrayBuffer)) {
            fail("音訊區塊格式錯誤");
            return;
          }
          bytes += m.data.byteLength;
          if (bytes > MAX_AUDIO_BYTES) {
            fail("音訊超過 64 MiB 上限");
            return;
          }
          chunks.push(new Uint8Array(m.data));
        }
        if (m.type === "complete") {
          if (
            m.bytes !== bytes ||
            !bytes ||
            Math.abs(m.durationMs - durationMs) > 1000
          ) {
            fail("音訊與影片長度不符");
            return;
          }
          cleanup();
          const result = new Uint8Array(bytes);
          let cursor = 0;
          for (const chunk of chunks) {
            result.set(chunk, cursor);
            cursor += chunk.length;
          }
          resolve(result);
        }
      };
      window.addEventListener("message", listener);
      signal.addEventListener("abort", cancel, { once: true });
      document.documentElement.append(frame);
    });
    progress("正在準備本機音訊…");
    for (
      let offset = 0, sequence = 0;
      offset < compressed.length;
      offset += 192 * 1024, sequence++
    ) {
      if (signal.aborted) throw new Error("工作已取消");
      let binary = "";
      const chunk = compressed.subarray(offset, offset + 192 * 1024);
      for (const byte of chunk) binary += String.fromCharCode(byte);
      await request({
        type: "audio-chunk",
        assetId,
        sequence,
        base64: btoa(binary),
      });
    }
    await request({ type: "audio-finish", assetId });
    return assetId;
  } catch (error) {
    await request({ type: "audio-clear" }).catch(() => {});
    throw error;
  }
}
