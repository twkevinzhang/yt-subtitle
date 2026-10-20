import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { inspectAudioInitialization } from "../../src/youtube/audio-initialization";
const node = (id: number[], data: number[]) => [
  ...id,
  0x80 | data.length,
  ...data,
];
const webm = (encrypted: boolean) =>
  new Uint8Array([
    ...node([0x1a, 0x45, 0xdf, 0xa3], []),
    0x18,
    0x53,
    0x80,
    0x67,
    0xff,
    ...node(
      [0x16, 0x54, 0xae, 0x6b],
      node(
        [0xae],
        [
          ...node([0x83], [2]),
          ...node([0x86], [65, 95, 79]),
          ...(encrypted
            ? node([0x6d, 0x80], node([0x62, 0x40], node([0x50, 0x35], [])))
            : []),
        ],
      ),
    ),
  ]);
it("accepts clear WebM initialization and identifies incomplete metadata", () => {
  expect(inspectAudioInitialization(webm(false), "audio/webm")).toBe("clear");
  expect(
    inspectAudioInitialization(webm(false).slice(0, -1), "audio/webm"),
  ).toBe("incomplete");
  expect(
    inspectAudioInitialization(new Uint8Array([1, 2, 3]), "audio/webm"),
  ).toBe("not-init");
  expect(
    inspectAudioInitialization(
      new Uint8Array(readFileSync("tests/fixtures/audio/tone.webm")),
      "audio/webm",
    ),
  ).toBe("clear");
});
it("identifies actual encryption metadata instead of mediaKeys", () => {
  expect(inspectAudioInitialization(webm(true), "audio/webm")).toBe(
    "encrypted",
  );
});
it("bounds malformed initialization rather than scanning arbitrary strings", () => {
  expect(
    inspectAudioInitialization(
      new TextEncoder().encode("noise enca sinf"),
      "audio/mp4",
    ),
  ).toBe("not-init");
  expect(
    inspectAudioInitialization(new Uint8Array(1024 * 1024 + 1), "audio/webm"),
  ).toBe("invalid");
});
it("distinguishes clear and encrypted MP4 audio sample entries", () => {
  const box = (type: string, payload: number[]) => {
    const result = new Uint8Array(8 + payload.length);
    new DataView(result.buffer).setUint32(0, result.length);
    result.set(
      [...type].map((c) => c.charCodeAt(0)),
      4,
    );
    result.set(payload, 8);
    return [...result];
  };
  const mp4 = (type: string) =>
    new Uint8Array(
      box("ftyp", []).concat(
        box(
          "moov",
          box(
            "trak",
            box(
              "mdia",
              box(
                "minf",
                box(
                  "stbl",
                  box("stsd", [
                    ...new Array(8).fill(0),
                    ...box(type, new Array(28).fill(0)),
                  ]),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  expect(inspectAudioInitialization(mp4("mp4a"), "audio/mp4")).toBe("clear");
  expect(inspectAudioInitialization(mp4("enca"), "audio/mp4")).toBe(
    "encrypted",
  );
  expect(
    inspectAudioInitialization(mp4("mp4a").slice(0, -1), "audio/mp4"),
  ).toBe("incomplete");
});
