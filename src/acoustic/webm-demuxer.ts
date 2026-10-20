// Streaming EBML parsing: retain only incomplete leaves, never wait for Segment EOF.
// Container/block rules: https://www.matroska.org/technical/notes.html
const LIMIT = 64 * 1024 * 1024;
export interface OpusTrack {
  number: number;
  channels: number;
  description: Uint8Array;
  delayUs: number;
}
export interface OpusPacket {
  timestampUs: number;
  durationUs: number;
  data: Uint8Array;
}
function vint(bytes: Uint8Array, at: number, id = false) {
  if (at >= bytes.length) return;
  const first = bytes[at];
  let width = 1;
  while (width <= 8 && !(first & (1 << (8 - width)))) width++;
  if (width > 8 || (id && width > 4)) throw new Error("無效 EBML 整數");
  if (at + width > bytes.length) return;
  let value = id ? first : first & ((1 << (8 - width)) - 1);
  let unknown = !id && value === (1 << (8 - width)) - 1;
  for (let i = 1; i < width; i++) {
    value = value * 256 + bytes[at + i];
    unknown &&= bytes[at + i] === 255;
  }
  if (!unknown && !Number.isSafeInteger(value))
    throw new Error("EBML 數值超出安全範圍");
  return { value, width, unknown };
}
const uint = (bytes: Uint8Array) => {
  const n = bytes.reduce((value, byte) => value * 256 + byte, 0);
  if (!Number.isSafeInteger(n)) throw new Error("EBML 數值超出安全範圍");
  return n;
};
function children(bytes: Uint8Array): { id: number; data: Uint8Array }[] {
  const result = [];
  for (let at = 0; at < bytes.length;) {
    const id = vint(bytes, at, true),
      size = id && vint(bytes, at + id.width);
    if (!id || !size || size.unknown) throw new Error("不完整 WebM metadata");
    const start = at + id.width + size.width,
      end = start + size.value;
    if (end > bytes.length) throw new Error("不完整 WebM metadata");
    result.push({ id: id.value, data: bytes.subarray(start, end) });
    at = end;
  }
  return result;
}
function packetDuration(data: Uint8Array) {
  if (!data.length) throw new Error("空 Opus packet");
  const config = data[0] >> 3;
  const ms =
    config >= 16
      ? 2.5 * 2 ** (config & 3)
      : config >= 12
        ? 10 * 2 ** (config & 1)
        : (config & 3) === 3
          ? 60
          : 10 * 2 ** (config & 3);
  const count =
    (data[0] & 3) === 0 ? 1 : (data[0] & 3) === 3 ? (data[1] ?? 0) & 63 : 2;
  if (!count || ms * count > 120) throw new Error("無效 Opus packet 長度");
  return ms * count * 1000;
}
export class WebmDemuxer {
  private bytes = new Uint8Array(0);
  private offset = 0;
  private stack: { id: number; end: number }[] = [];
  private scale = 1000000;
  private clusterTime = 0;
  private track?: OpusTrack;
  private needsSegment = false;
  private repeatedInitialization = false;
  constructor(
    private onTrack: (track: OpusTrack) => void,
    private onPacket: (packet: OpusPacket) => void,
  ) {}
  discontinuity() {
    // SourceBuffer.abort() discards an unfinished media segment but retains the
    // initialized track. Do not concatenate its remaining leaves with a seek.
    this.bytes = new Uint8Array(0);
    this.offset = 0;
    this.stack = [];
    this.clusterTime = 0;
    this.needsSegment = true;
  }
  push(data: Uint8Array, nativeAppendBoundary = false) {
    if (
      nativeAppendBoundary &&
      this.track &&
      [0x1a, 0x45, 0xdf, 0xa3].every((b, i) => data[i] === b)
    ) {
      this.discontinuity();
      this.needsSegment = false;
      this.repeatedInitialization = true;
    }
    // MSE can append a new media segment after a seek without calling the
    // instance abort wrapper. Recognize only a Cluster at the exact native
    // append boundary with its first Timestamp child, never scan packet bytes.
    if (
      nativeAppendBoundary &&
      this.track &&
      data.length >= 4 &&
      data[0] === 0x1f &&
      data[1] === 0x43 &&
      data[2] === 0xb6 &&
      data[3] === 0x75
    ) {
      const id = vint(data, 0, true),
        size = id?.value === 0x1f43b675 && vint(data, id.width);
      if (id && size) {
        const start = id.width + size.width,
          time = vint(data, start, true),
          length = time?.value === 0xe7 && vint(data, start + time.width);
        if (
          time &&
          length &&
          !length.unknown &&
          length.value > 0 &&
          length.value <= 8 &&
          start + time.width + length.width + length.value <= data.length
        )
          this.discontinuity();
      }
    }
    if (this.bytes.length + data.length > LIMIT)
      throw new Error("壓縮音訊超過 64 MiB");
    const joined = new Uint8Array(this.bytes.length + data.length);
    joined.set(this.bytes);
    joined.set(data, this.bytes.length);
    this.bytes = joined;
    let at = 0;
    while (at < this.bytes.length) {
      while (this.stack.length && this.offset + at >= this.stack.at(-1)!.end)
        this.stack.pop();
      const id = vint(this.bytes, at, true),
        size = id && vint(this.bytes, at + id.width);
      if (!id || !size) break;
      if (this.needsSegment) {
        if (id.value !== 0x1f43b675)
          throw new Error("跳轉後缺少完整 WebM Cluster 邊界");
        this.needsSegment = false;
      }
      const start = at + id.width + size.width;
      // A new level-1 element ends a preceding unknown-size Cluster.
      if (
        [0x1f43b675, 0x1c53bb6b].includes(id.value) &&
        this.stack.at(-1)?.id === 0x1f43b675 &&
        this.stack.at(-1)?.end === Infinity
      )
        this.stack.pop();
      const container = [0x18538067, 0x1654ae6b, 0x1f43b675].includes(id.value);
      if (size.unknown && !container)
        throw new Error("不支援未知長度 WebM 元素");
      const end = size.unknown ? Infinity : this.offset + start + size.value;
      if (end > (this.stack.at(-1)?.end ?? Infinity))
        throw new Error(
          `WebM 元素超出容器（元素 ${id.value.toString(16)}，位置 ${this.offset + at}，結尾 ${end}，容器 ${this.stack.at(-1)?.id.toString(16)}／${this.stack.at(-1)?.end}）`,
        );
      if (container) {
        if (id.value === 0x1f43b675 && this.repeatedInitialization)
          throw new Error("重送 WebM 初始化缺少音軌確認");
        this.stack.push({ id: id.value, end });
        if (id.value === 0x1f43b675) this.clusterTime = 0;
        at = start;
        continue;
      }
      if (size.value > LIMIT) throw new Error("WebM 元素超過 64 MiB");
      if (start + size.value > this.bytes.length) break;
      this.element(id.value, this.bytes.subarray(start, start + size.value));
      at = start + size.value;
    }
    this.offset += at;
    this.bytes = this.bytes.slice(at);
  }
  private element(id: number, data: Uint8Array) {
    if (id === 0x1549a966) {
      for (const c of children(data))
        if (c.id === 0x2ad7b1) {
          const scale = uint(c.data);
          if (this.repeatedInitialization && scale !== this.scale)
            throw new Error("重送 WebM 初始化的時間軸比例不同");
          this.scale = scale;
        }
      if (!this.scale) throw new Error("WebM TimestampScale 無效");
    } else if (id === 0xae) {
      const fields = children(data),
        get = (key: number) => fields.find((c) => c.id === key)?.data;
      if (uint(get(0x83) ?? new Uint8Array([0])) !== 2) return;
      const codec = new TextDecoder().decode(get(0x86));
      if (codec !== "A_OPUS") throw new Error("不支援的 WebM 音訊 codec");
      const description = get(0x63a2);
      if (
        !description ||
        description.length < 19 ||
        new TextDecoder().decode(description.subarray(0, 8)) !== "OpusHead" ||
        description[18] !== 0
      )
        throw new Error("不支援的 OpusHead");
      const channels = description[9];
      if (channels < 1 || channels > 2) throw new Error("不支援的 Opus 聲道數");
      const delay = get(0x56aa);
      const nextTrack = {
        number: uint(get(0xd7) ?? new Uint8Array([0])),
        channels,
        description: description.slice(),
        delayUs: delay
          ? uint(delay) / 1000
          : ((description[10] + description[11] * 256) / 48) * 1000,
      };
      if (this.track) {
        const prior = this.track;
        if (
          !this.repeatedInitialization ||
          nextTrack.number !== prior.number ||
          nextTrack.channels !== prior.channels ||
          nextTrack.delayUs !== prior.delayUs ||
          nextTrack.description.length !== prior.description.length ||
          nextTrack.description.some((b, i) => b !== prior.description[i])
        )
          throw new Error("WebM 音軌初始化不一致或包含多音軌");
        this.repeatedInitialization = false;
        return;
      }
      this.track = nextTrack;
      this.onTrack(this.track);
    } else if (id === 0xe7) this.clusterTime = uint(data);
    else if (id === 0xa3 || id === 0xa1) this.block(data);
    else if (id === 0xa0)
      for (const c of children(data)) if (c.id === 0xa1) this.block(c.data);
  }
  private block(data: Uint8Array) {
    const track = vint(data, 0);
    if (!track || data.length < track.width + 3)
      throw new Error("無效 WebM block");
    if (!this.track) throw new Error("WebM block 缺少初始化音軌");
    if (track.value !== this.track.number) return;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let timestampUs =
      ((this.clusterTime + view.getInt16(track.width)) * this.scale) / 1000 -
      this.track.delayUs;
    const flags = data[track.width + 2],
      mode = (flags >> 1) & 3;
    let at = track.width + 3;
    const sizes: number[] = [];
    if (mode) {
      const count = data[at++] + 1;
      if (mode === 2) {
        const size = (data.length - at) / count;
        if (!Number.isInteger(size)) throw new Error("無效 fixed lacing");
        sizes.push(...Array(count - 1).fill(size));
      } else
        for (let i = 0; i < count - 1; i++) {
          if (mode === 1) {
            let size = 0,
              part;
            do {
              if (at >= data.length) throw new Error("無效 Xiph lacing");
              part = data[at++];
              size += part;
            } while (part === 255);
            sizes.push(size);
          } else {
            const value = vint(data, at);
            if (!value || value.unknown) throw new Error("無效 EBML lacing");
            at += value.width;
            sizes.push(
              i === 0
                ? value.value
                : sizes[i - 1] + value.value - (2 ** (7 * value.width - 1) - 1),
            );
          }
        }
    }
    sizes.push(data.length - at - sizes.reduce((a, b) => a + b, 0));
    for (const size of sizes) {
      if (size <= 0 || at + size > data.length)
        throw new Error("無效 lace frame 長度");
      const packet = data.slice(at, at + size);
      const durationUs = packetDuration(packet);
      this.onPacket({
        timestampUs: Math.round(timestampUs),
        durationUs,
        data: packet,
      });
      timestampUs += durationUs;
      at += size;
    }
  }
}
