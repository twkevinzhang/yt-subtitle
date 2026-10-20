/** Inspect container metadata, never infer encryption from HTMLMediaElement.mediaKeys. */
export type InitializationState =
  "clear" | "encrypted" | "incomplete" | "not-init" | "invalid";
const MAX_INIT = 1024 * 1024;
function integer(data: Uint8Array, at: number, id = false) {
  if (at >= data.length) return;
  let width = 1;
  while (width <= 8 && !(data[at] & (1 << (8 - width)))) width++;
  if (width > 8 || (id && width > 4)) throw new Error("invalid EBML");
  if (at + width > data.length) return;
  let value = id ? data[at] : data[at] & ((1 << (8 - width)) - 1);
  let unknown = !id && value === (1 << (8 - width)) - 1;
  for (let i = 1; i < width; i++) {
    value = value * 256 + data[at + i];
    unknown &&= data[at + i] === 255;
  }
  if (!unknown && !Number.isSafeInteger(value)) throw new Error("invalid size");
  return { width, value, unknown };
}
function ebmlFields(data: Uint8Array): { id: number; data: Uint8Array }[] {
  const fields = [];
  for (let at = 0; at < data.length;) {
    const id = integer(data, at, true),
      size = id && integer(data, at + id.width);
    if (!id || !size || size.unknown) throw new Error("invalid metadata");
    const start = at + id.width + size.width,
      end = start + size.value;
    if (end > data.length) throw new Error("invalid metadata size");
    fields.push({ id: id.value, data: data.subarray(start, end) });
    at = end;
  }
  return fields;
}
function webm(data: Uint8Array): InitializationState {
  const signature = [0x1a, 0x45, 0xdf, 0xa3];
  if (
    !signature.slice(0, Math.min(data.length, 4)).every((b, i) => data[i] === b)
  )
    return "not-init";
  for (let at = 0; at < data.length;) {
    const id = integer(data, at, true),
      size = id && integer(data, at + id.width);
    if (!id || !size) return "incomplete";
    const start = at + id.width + size.width;
    if (id.value === 0x18538067) {
      at = start;
      continue;
    }
    if (size.unknown) return "invalid";
    const end = start + size.value;
    if (end > data.length) return "incomplete";
    if (id.value === 0x1654ae6b) {
      const tracks = ebmlFields(data.subarray(start, end)).filter(
        (c) => c.id === 0xae,
      );
      let audioFound = false;
      for (const track of tracks) {
        const fields = ebmlFields(track.data);
        if (fields.find((f) => f.id === 0x83)?.data[0] !== 2) continue;
        audioFound = true;
        for (const encodings of fields.filter((f) => f.id === 0x6d80))
          for (const encoding of ebmlFields(encodings.data).filter(
            (f) => f.id === 0x6240,
          ))
            if (ebmlFields(encoding.data).some((f) => f.id === 0x5035))
              return "encrypted";
      }
      return audioFound ? "clear" : "invalid";
    }
    at = end;
  }
  return "incomplete";
}
function mp4(data: Uint8Array): InitializationState {
  if (data.length < 8) return "incomplete";
  const text = (at: number) =>
    String.fromCharCode(...data.subarray(at, at + 4));
  if (!["ftyp", "moov"].includes(text(4))) return "not-init";
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let audio = false,
    encrypted = false;
  function boxes(start: number, end: number, depth: number): boolean {
    if (depth > 10) throw new Error("MP4 nesting limit");
    for (let at = start; at < end;) {
      if (at + 8 > end) return false;
      const type = text(at + 4);
      let size = view.getUint32(at),
        header = 8;
      if (size === 1) {
        if (at + 16 > end) return false;
        size = Number(view.getBigUint64(at + 8));
        header = 16;
      }
      if (size < header || !Number.isSafeInteger(size))
        throw new Error("invalid MP4 size");
      if (at + size > end) return false;
      if (type === "enca") {
        audio = true;
        encrypted = true;
      }
      if (["mp4a", "Opus", "ac-3", "ec-3"].includes(type)) audio = true;
      if (["moov", "trak", "mdia", "minf", "stbl", "stsd"].includes(type)) {
        if (
          !boxes(at + header + (type === "stsd" ? 8 : 0), at + size, depth + 1)
        )
          return false;
      }
      at += size;
    }
    return true;
  }
  if (!boxes(0, data.length, 0)) return "incomplete";
  return encrypted ? "encrypted" : audio ? "clear" : "incomplete";
}
export function inspectAudioInitialization(
  data: Uint8Array,
  mime: string,
): InitializationState {
  if (data.length > MAX_INIT) return "invalid";
  try {
    if (mime.startsWith("audio/webm")) return webm(data);
    if (mime.startsWith("audio/mp4")) return mp4(data);
    return "invalid";
  } catch {
    return "invalid";
  }
}
