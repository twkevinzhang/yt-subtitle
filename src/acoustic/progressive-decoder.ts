import type {
  AudioChunk,
  PcmRange,
  ProgressiveDecoder,
} from "./progressive-contracts";
import { WebmDemuxer, type OpusTrack, type OpusPacket } from "./webm-demuxer";
import type { TimeRange } from "./contracts";
import { MAX_AUDIO_BYTES } from "./contracts";

// Audio WebCodecs declarations are not included in this project's DOM typings.
interface DecodedAudio {
  timestamp: number;
  sampleRate: number;
  numberOfFrames: number;
  numberOfChannels: number;
  copyTo(
    destination: Float32Array,
    options: { planeIndex: number; format: "f32-planar" },
  ): void;
  close(): void;
}
interface NativeDecoder {
  state: string;
  decodeQueueSize: number;
  addEventListener(type: "dequeue", listener: () => void): void;
  removeEventListener(type: "dequeue", listener: () => void): void;
  configure(config: object): void;
  decode(chunk: object): void;
  flush(): Promise<void>;
  close(): void;
}
interface DecoderConstructor {
  new (callbacks: {
    output: (audio: DecodedAudio) => void;
    error: (error: Error) => void;
  }): NativeDecoder;
  isConfigSupported(config: object): Promise<{ supported?: boolean }>;
}
export function createProgressiveDecoder(
  onRange: (range: PcmRange) => void,
  onError: (error: Error) => void,
  requestedRange: () => TimeRange | undefined = () => undefined,
  maximumRetainedBytes: () => number = () => MAX_AUDIO_BYTES,
): ProgressiveDecoder {
  let generation = 0,
    sequence = 0,
    token = 0,
    disposed = false,
    failed = false;
  let native: NativeDecoder | undefined;
  let configure: Promise<void> | undefined;
  let codecConfig: object | undefined;
  let decoderConstructor: DecoderConstructor | undefined;
  let lastInputEndUs: number | undefined;
  let lastEndSample: number | undefined;
  let queued: Promise<void> = Promise.resolve();
  const drains = new Set<() => void>();
  const globals = globalThis as unknown as {
    AudioDecoder?: DecoderConstructor;
    EncodedAudioChunk?: new (data: object) => object;
  };
  const error = (value: unknown) =>
    value instanceof Error ? value : new Error(String(value));
  const close = () => {
    if (native && native.state !== "closed") native.close();
    for (const drain of [...drains]) drain();
    native = undefined;
  };
  function waitForQueue(
    decoder: NativeDecoder,
    maximum: number,
  ): Promise<void> {
    if (!(decoder.decodeQueueSize > maximum)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let lastSize = decoder.decodeQueueSize;
      const timeout = () => {
        decoder.removeEventListener("dequeue", check);
        drains.delete(finish);
        reject(new Error("音訊解碼 5 秒沒有進度"));
      };
      let timer = setTimeout(timeout, 5000);
      const finish = () => {
        clearTimeout(timer);
        decoder.removeEventListener("dequeue", check);
        drains.delete(finish);
        resolve();
      };
      const check = () => {
        if (decoder.decodeQueueSize <= maximum || decoder.state === "closed")
          finish();
        else if (decoder.decodeQueueSize < lastSize) {
          lastSize = decoder.decodeQueueSize;
          clearTimeout(timer);
          timer = setTimeout(timeout, 5000);
        }
      };
      drains.add(finish);
      decoder.addEventListener("dequeue", check);
      check();
    });
  }
  function output(audio: DecodedAudio, expected: number) {
    try {
      if (expected !== token || disposed || failed) return;
      const mono = new Float32Array(audio.numberOfFrames),
        plane = new Float32Array(audio.numberOfFrames);
      for (let c = 0; c < audio.numberOfChannels; c++) {
        audio.copyTo(plane, { planeIndex: c, format: "f32-planar" });
        for (let i = 0; i < plane.length; i++)
          mono[i] += plane[i] / audio.numberOfChannels;
      }
      const start = (audio.timestamp / 1000) * 16;
      const first = Math.max(0, Math.ceil(start - 0.001), lastEndSample ?? 0);
      const end = Math.ceil(
        start + (mono.length / audio.sampleRate) * 16000 - 0.001,
      );
      if (end <= first) return;
      const pcm = new Float32Array(end - first);
      for (let i = 0; i < pcm.length; i++) {
        const at = Math.max(
          0,
          ((first + i - start) * audio.sampleRate) / 16000,
        );
        const a = Math.floor(at),
          fraction = at - a;
        pcm[i] =
          (mono[a] ?? 0) * (1 - fraction) +
          (mono[Math.min(a + 1, mono.length - 1)] ?? 0) * fraction;
      }
      lastEndSample = end;
      onRange({ generation, startMs: first / 16, sampleRate: 16000, pcm });
    } finally {
      audio.close();
    }
  }
  let packets: OpusPacket[] = [];
  let retained: OpusPacket[] = [];
  let retainedBytes = 0;
  let inputEnded = false;
  const retainedKeys = new Set<string>();
  function clearRetained() {
    retained = [];
    retainedBytes = 0;
    retainedKeys.clear();
  }
  async function decodePackets(current: OpusPacket[], expected: number) {
    const wanted = requestedRange();
    let decoder = native;
    for (const packet of current) {
      if (expected !== token || disposed || failed)
        throw new Error("音訊 generation 已改變");
      if (wanted && packet.timestampUs >= wanted.endMs * 1000 + 120000) {
        const key = `${packet.timestampUs}:${packet.durationUs}`;
        if (!retainedKeys.has(key)) {
          if (
            retainedBytes + packet.data.byteLength >
            Math.min(MAX_AUDIO_BYTES, maximumRetainedBytes())
          )
            throw new Error("待解碼壓縮音訊超過 64 MiB");
          // Own only these packet bytes, not the entire native append backing buffer.
          retained.push({ ...packet, data: packet.data.slice() });
          retainedKeys.add(key);
          retainedBytes += packet.data.byteLength;
        }
        continue;
      }
      if (
        wanted &&
        packet.timestampUs + packet.durationUs < wanted.startMs * 1000 - 120000
      )
        continue;
      if (
        lastInputEndUs !== undefined &&
        packet.timestampUs + packet.durationUs <= lastInputEndUs
      )
        continue;
      // Chromium keeps its PCM clock across real encoded timestamp jumps.
      // MediaRecorder's continuous packet times can jitter by ±9ms.
      if (
        lastInputEndUs !== undefined &&
        Math.abs(packet.timestampUs - lastInputEndUs) > 10000
      ) {
        await waitForQueue(decoder!, 0);
        await flushDecoder(decoder);
        if (expected !== token || disposed || failed)
          throw new Error("音訊 generation 已改變");
        decoder!.close();
        decoder = openDecoder(expected);
      }
      decoder!.decode(
        new globals.EncodedAudioChunk!({
          type: "key",
          timestamp: packet.timestampUs,
          data: packet.data,
        }),
      );
      lastInputEndUs = packet.timestampUs + packet.durationUs;
      if (decoder!.decodeQueueSize >= 64) await waitForQueue(decoder!, 32);
    }
    if (decoder) await waitForQueue(decoder, 0);
    if (expected !== token || disposed)
      throw new Error("音訊 generation 已改變");
    if (failed) throw new Error("音訊解碼失敗");
  }
  function openDecoder(expected: number) {
    const decoder = new decoderConstructor!({
      output: (audio) => {
        if (native !== decoder) {
          audio.close();
          return;
        }
        output(audio, expected);
      },
      error: (e) => {
        if (expected !== token || disposed || failed || native !== decoder)
          return;
        failed = true;
        close();
        onError(e);
      },
    });
    native = decoder;
    decoder.configure(codecConfig!);
    return decoder;
  }
  async function flushDecoder(decoder: NativeDecoder | undefined) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        decoder?.flush(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("音訊收尾達 5 秒上限")),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  function track(info: OpusTrack) {
    const ctor = globals.AudioDecoder;
    if (!ctor) throw new Error("瀏覽器不支援 Audio WebCodecs");
    const expected = token;
    const config = {
      codec: "opus",
      sampleRate: 48000,
      numberOfChannels: info.channels,
      description: info.description,
    };
    codecConfig = config;
    decoderConstructor = ctor;
    configure = ctor.isConfigSupported(config).then((support) => {
      if (expected !== token || disposed) return;
      if (!support.supported) throw new Error("瀏覽器不支援 Opus 解碼");
      openDecoder(expected);
    });
  }
  const demux = () => new WebmDemuxer(track, (packet) => packets.push(packet));
  let parser = demux();
  return {
    bufferedBytes: () => retainedBytes,
    decodeRequested() {
      const expected = token;
      const task = queued.then(async () => {
        if (expected !== token || disposed || failed)
          throw new Error("解碼器已停止");
        const current = retained;
        clearRetained();
        await decodePackets(current, expected);
        if (inputEnded && !retained.length) await flushDecoder(native);
        if (expected !== token || disposed || failed)
          throw new Error("音訊 generation 已改變");
      });
      queued = task.catch(() => {});
      return task.catch((e) => {
        if (expected === token && !disposed) {
          failed = true;
          close();
        }
        throw error(e);
      });
    },
    async discontinuity() {
      const expected = token;
      await queued;
      if (disposed || failed || expected !== token)
        throw new Error("解碼器已停止");
      parser.discontinuity();
    },
    async finish() {
      const expected = token;
      await queued;
      if (disposed || failed || expected !== token)
        throw new Error("解碼器已停止");
      inputEnded = true;
      // Native EOF can arrive before later cached windows are requested.
      // Keep their codec sequence open until those packets have been decoded.
      if (!retained.length) await flushDecoder(native);
      if (disposed || failed || expected !== token)
        throw new Error("音訊 generation 已改變");
    },
    push(chunk: AudioChunk) {
      const expected = token;
      const task = queued.then(async () => {
        if (disposed || failed) throw new Error("解碼器已停止");
        if (expected !== token || chunk.generation !== generation)
          throw new Error("音訊 generation 已改變");
        if (chunk.sequence !== sequence || chunk.init !== (sequence === 0))
          throw new Error("音訊 sequence 不連續或缺初始化");
        if (!/^audio\/webm(?:\s*;.*)?$/i.test(chunk.mime))
          throw new Error("不支援的漸進音訊格式，目前僅支援 WebM／Opus");
        if (!globals.AudioDecoder || !globals.EncodedAudioChunk)
          throw new Error("瀏覽器不支援 Audio WebCodecs");
        sequence++;
        inputEnded = false;
        parser.push(new Uint8Array(chunk.data), true);
        await configure;
        if (expected !== token || disposed)
          throw new Error("音訊 generation 已改變");
        const current = packets;
        packets = [];
        await decodePackets(current, expected);
      });
      queued = task.catch(() => {});
      return task.catch((e) => {
        if (expected === token && !disposed) {
          failed = true;
          close();
        }
        throw error(e);
      });
    },
    reset(nextGeneration) {
      if (!Number.isSafeInteger(nextGeneration) || nextGeneration <= generation)
        throw new Error("generation 必須遞增");
      token++;
      close();
      generation = nextGeneration;
      sequence = 0;
      failed = false;
      lastEndSample = undefined;
      lastInputEndUs = undefined;
      codecConfig = undefined;
      decoderConstructor = undefined;
      packets = [];
      clearRetained();
      inputEnded = false;
      configure = undefined;
      parser = demux();
      queued = Promise.resolve();
    },
    dispose() {
      disposed = true;
      token++;
      close();
      packets = [];
      clearRetained();
      parser = demux();
    },
  };
}
