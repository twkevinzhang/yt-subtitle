import { RangeAudioSource } from "./progressive-audio-source";
import { createProgressiveDecoder } from "./progressive-decoder";
import type { ProgressiveDecoder } from "./progressive-contracts";
import type { JobKey, TimeRange } from "./contracts";
import { MAX_AUDIO_BYTES } from "./contracts";

/** One helper per work, range controlled; no audio ever leaves the extension for AI. */
export function createProgressiveAudioSource(
  key: JobKey,
  durationMs: number,
  onNotice: (text: string) => void = () => {},
) {
  let frame: HTMLIFrameElement | undefined,
    decoder: ProgressiveDecoder | undefined,
    nonce = "",
    wanted: TimeRange | undefined;
  let pendingBytes = 0,
    peakCompressedBytes = 0,
    maximumEnd = 0,
    decodeEpoch = 0,
    helperGeneration = 0,
    chain: Promise<void> = Promise.resolve(),
    disposed = false;
  const command = (action: string) =>
    frame?.contentWindow?.postMessage(
      { tag: "ai-lyrics-control", nonce, action, range: wanted },
      "https://www.youtube.com",
    );
  const release = () => {
    command("stop");
    frame?.remove();
    frame = undefined;
    decoder?.dispose();
    decoder = undefined;
    pendingBytes = 0;
  };
  const source = new RangeAudioSource(
    durationMs,
    (range) => {
      wanted = range;
      if (
        frame &&
        range.endMs < maximumEnd &&
        !source
          .availableRanges()
          .some((r) => r.startMs <= range.startMs && r.endMs >= range.endMs)
      ) {
        release();
        source.reset(source.generation + 1);
        maximumEnd = 0;
      }
      if (!frame) open();
      else command("range");
    },
    MAX_AUDIO_BYTES,
    () => {
      disposed = true;
      release();
      window.removeEventListener("message", receive);
    },
  );
  function open() {
    helperGeneration = 0;
    nonce = crypto.randomUUID();
    frame = document.createElement("iframe");
    frame.src = `https://www.youtube.com/watch?v=${key.videoId}&ai-lyrics-audio=${nonce}&ai-lyrics-duration=${durationMs}&ai-lyrics-stream=1&autoplay=1&mute=1`;
    frame.allow = "autoplay";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText =
      "position:fixed;opacity:0;pointer-events:none;width:480px;height:270px;z-index:-1";
    const ownFrame = frame;
    decoder = createProgressiveDecoder(
      (range) => {
        if (disposed || frame !== ownFrame) return;
        maximumEnd = Math.max(
          maximumEnd,
          range.startMs + range.pcm.length / 16,
        );
        source.append({ ...range, generation: decodeEpoch });
        if (
          wanted &&
          source
            .availableRanges()
            .some(
              (r) => r.startMs <= wanted!.startMs && r.endMs >= wanted!.endMs,
            )
        )
          command("pause");
      },
      (error) => {
        if (frame === ownFrame) source.fail(error);
      },
    );
    frame.onload = () => command("range");
    document.documentElement.append(frame);
  }
  function receive(event: MessageEvent) {
    if (
      disposed ||
      event.source !== frame?.contentWindow ||
      event.origin !== "https://www.youtube.com" ||
      event.data?.tag !== "ai-lyrics-audio" ||
      event.data?.nonce !== nonce
    )
      return;
    const m = event.data,
      ownFrame = frame,
      ownDecoder = decoder!;
    if (m.type === "ready") {
      command("range");
      return;
    }
    if (m.type === "reset") {
      helperGeneration = m.generation;
      source.reset(source.generation + 1);
      maximumEnd = 0;
    }
    const messageEpoch = source.generation;
    if (m.type === "eof" && m.generation !== helperGeneration) return;
    if (m.type === "status")
      onNotice(
        m.state === "waiting-ad"
          ? "廣告播放中，暫停收音…"
          : m.state === "awaiting-content"
            ? "正在確認正片音源…"
            : "繼續取得正片音訊…",
      );
    if (m.type === "error") {
      const ranges = source
        .availableRanges()
        .map((r) => `${r.startMs.toFixed(1)}–${r.endMs.toFixed(1)}`)
        .join(", ");
      source.fail(
        new Error(
          `${m.message}${m.code === "no-progress" ? `（已解碼毫秒：${ranges || "無"}）` : ""}`,
        ),
      );
      return;
    }
    if (m.type === "chunk") {
      if (!(m.data instanceof ArrayBuffer)) {
        source.fail(new Error("音訊區塊無效"));
        return;
      }
      pendingBytes += m.data.byteLength;
      peakCompressedBytes = Math.max(peakCompressedBytes, pendingBytes);
      if (pendingBytes > MAX_AUDIO_BYTES) {
        source.fail(new Error("壓縮音訊超過 64 MiB"));
        return;
      }
    }
    if (
      m.type !== "reset" &&
      m.type !== "chunk" &&
      m.type !== "eof" &&
      m.type !== "discontinuity"
    )
      return;
    // Reset waits for preceding decode work; its PCM is invalidated before the next generation.
    chain = chain
      .then(async () => {
        if (disposed || frame !== ownFrame) return;
        if (m.type === "reset") {
          ownDecoder.reset(m.generation);
          return;
        }
        decodeEpoch = messageEpoch;
        if (m.type === "discontinuity") {
          if (
            messageEpoch === source.generation &&
            m.generation === helperGeneration
          )
            await ownDecoder.discontinuity();
          return;
        }
        if (m.type === "eof") {
          if (messageEpoch !== source.generation) return;
          await ownDecoder.finish();
          source.finish(messageEpoch);
          if (messageEpoch === source.generation && wanted) {
            const actual = source.readableRange(wanted);
            if (
              !source
                .availableRanges()
                .some(
                  (r) => r.startMs <= actual.startMs && r.endMs >= actual.endMs,
                )
            )
              source.fail(
                new Error(
                  "正片已結束，但解碼音訊仍有缺口；歌詞與已完成時間均已保留",
                ),
              );
          }
          return;
        }
        try {
          await ownDecoder.push({
            generation: m.generation,
            sequence: m.sequence,
            init: m.init,
            mime: m.mime,
            data: m.data,
          });
        } finally {
          if (frame === ownFrame) pendingBytes -= m.data.byteLength;
        }
      })
      .catch((e) => {
        if (!disposed && frame === ownFrame)
          source.fail(e instanceof Error ? e : new Error(String(e)));
      });
  }
  window.addEventListener("message", receive);
  return Object.assign(source, {
    streamStats: () => ({
      ...source.stats(),
      compressedBytes: pendingBytes,
      peakCompressedBytes,
      totalBytes: source.stats().pcmBytes + pendingBytes,
    }),
  });
}
