// Wire definitions: LuanRT/googlevideo protos/video_streaming (MIT).
// Keep opaque protobuf fields byte-for-byte; only field 19 -> field 2 is ours.
type Field = {
  id: number;
  wire: number;
  raw: Uint8Array;
  value?: Uint8Array;
  scalar?: number;
};
const MAX_BODY = 2 * 1024 * 1024;

function protobufFields(bytes: Uint8Array): Field[] {
  let at = 0;
  const fields: Field[] = [];
  const integer = () => {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      if (at >= bytes.length) throw new Error("truncated varint");
      const byte = bytes[at++];
      value += (byte & 127) * 2 ** shift;
      if (byte < 128) return value;
    }
    throw new Error("oversized varint");
  };
  while (at < bytes.length) {
    if (fields.length >= 4096) throw new Error("too many fields");
    const start = at,
      key = integer(),
      id = Math.floor(key / 8),
      wire = key % 8;
    if (!id || key > 0xffffffff) throw new Error("invalid key");
    let value: Uint8Array | undefined, scalar: number | undefined;
    if (wire === 2) {
      const length = integer(),
        end = at + length;
      if (end > bytes.length) throw new Error("truncated bytes");
      value = bytes.subarray(at, end);
      at = end;
    } else if (wire === 0) {
      let ended = false;
      let decoded = 0;
      for (let i = 0; i < 10; i++) {
        if (at >= bytes.length) break;
        const byte = bytes[at++];
        if (i === 9 && byte > 1) throw new Error("overflowing scalar");
        decoded += (byte & 127) * 2 ** (7 * i);
        if (byte < 128) {
          ended = true;
          break;
        }
      }
      if (!ended) throw new Error("invalid scalar");
      if (Number.isSafeInteger(decoded)) scalar = decoded;
    } else if (wire === 1 || wire === 5) {
      at += wire === 1 ? 8 : 4;
      if (at > bytes.length) throw new Error("truncated fixed field");
    } else throw new Error("unsupported wire type");
    fields.push({ id, wire, raw: bytes.subarray(start, at), value, scalar });
  }
  return fields;
}
function varint(value: number): Uint8Array {
  const out: number[] = [];
  do {
    const byte = value % 128;
    value = Math.floor(value / 128);
    out.push(byte | (value ? 128 : 0));
  } while (value);
  return new Uint8Array(out);
}
function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
const bytesField = (id: number, value: Uint8Array) =>
  join([varint(id * 8 + 2), varint(value.length), value]);

export function replaceSabrPoToken(
  body: Uint8Array,
  token: Uint8Array,
): Uint8Array | undefined {
  if (
    !body.length ||
    body.length > MAX_BODY ||
    !token.length ||
    token.length > 4096
  )
    return;
  try {
    const outer = protobufFields(body),
      contexts = outer.filter((f) => f.id === 19);
    if (contexts.length !== 1 || !contexts[0].value) return;
    const context = contexts[0],
      inner = protobufFields(context.value!);
    let written = false;
    const rewritten = inner.flatMap((field) => {
      if (field.id !== 2) return [field.raw];
      if (written) return [];
      written = true;
      return [bytesField(2, token)];
    });
    if (!written) rewritten.push(bytesField(2, token));
    const replacement = bytesField(19, join(rewritten));
    return join(
      outer.map((field) => (field === context ? replacement : field.raw)),
    );
  } catch {
    return;
  }
}

export function readStreamProtectionStatus(
  body: Uint8Array,
): 1 | 2 | 3 | undefined {
  let at = 0;
  const integer = () => {
    if (at >= body.length) throw new Error("truncated UMP integer");
    const first = body[at++];
    const count =
      first < 128 ? 0 : first < 192 ? 1 : first < 224 ? 2 : first < 240 ? 3 : 4;
    if (at + count > body.length) throw new Error("truncated UMP integer");
    let value = count === 4 ? 0 : first & (127 >> count);
    const shift = count === 4 ? 0 : 7 - count;
    for (let i = 0; i < count; i++) value += body[at++] * 2 ** (shift + i * 8);
    return value;
  };
  try {
    for (let count = 0; at < body.length && count < 256; count++) {
      const type = integer(),
        length = integer(),
        end = at + length;
      if (end > body.length) return;
      if (type === 58) {
        const status = protobufFields(body.subarray(at, end))
          .filter((f) => f.id === 1 && f.wire === 0)
          .at(-1)?.scalar;
        if (status === 1 || status === 2 || status === 3) return status;
        return;
      }
      at = end;
    }
  } catch {
    return;
  }
}
