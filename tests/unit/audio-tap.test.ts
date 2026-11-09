import { it, expect } from "vitest";
import {
  cleanWebm,
  concatChunks,
  contiguousCoverage,
  isWebm,
  pcmToBase64,
  base64ToFloat32,
  unbufferedGaps,
} from "../../src/youtube/audio-tap";

const be = (n: number, width: number) =>
  Array.from({ length: width }, (_, i) => (n >> (8 * (width - 1 - i))) & 0xff);
const element = (id: number[], payload: number[]) => [
  ...id,
  0x01,
  0,
  0,
  0,
  0,
  ...be(payload.length, 3),
  ...payload,
];
const ebmlHeader = (doc: number[]) => element([0x1a, 0x45, 0xdf, 0xa3], doc);
const segmentOpen = () => [
  0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
];
const tracks = (tag: number) => element([0x16, 0x54, 0xae, 0x6b], [tag]);
const cluster = (timecodeMs: number, fill: number) =>
  element(
    [0x1f, 0x43, 0xb6, 0x75],
    [
      ...element([0xe7], be(timecodeMs, 3)),
      ...element([0xa3], [fill, fill, fill]),
    ],
  );
const init = (tag = 1) => [
  ...ebmlHeader([0x42, 0x82, tag]),
  ...segmentOpen(),
  ...tracks(tag),
];
const bytes = (...parts: number[][]) => new Uint8Array(parts.flat());

it("keeps each cluster once, ordered by timecode, after a re-appended init", () => {
  const stream = bytes(
    init(),
    cluster(0, 1),
    cluster(10000, 2),
    init(),
    cluster(10000, 2),
    cluster(20000, 3),
  );
  const { clean, report } = cleanWebm(stream);
  expect(isWebm(clean)).toBe(true);
  expect(report).toMatchObject({
    headers: 2,
    clusters: 4,
    unique: 3,
    duplicates: 1,
    firstMs: 0,
    lastMs: 20000,
    medianStepMs: 10000,
    mixedInit: false,
    error: null,
  });
  expect(Array.from(clean)).toEqual(
    Array.from(
      bytes(init(), cluster(0, 1), cluster(10000, 2), cluster(20000, 3)),
    ),
  );
});
it("sorts clusters that arrive out of order after a seek", () => {
  const { clean, report } = cleanWebm(
    bytes(init(), cluster(20000, 3), cluster(0, 1), cluster(10000, 2)),
  );
  expect(report.unique).toBe(3);
  expect(Array.from(clean)).toEqual(
    Array.from(
      bytes(init(), cluster(0, 1), cluster(10000, 2), cluster(20000, 3)),
    ),
  );
});
it("flags a changed init segment instead of silently mixing formats", () => {
  const { report } = cleanWebm(
    bytes(init(1), cluster(0, 1), init(2), cluster(10000, 2)),
  );
  expect(report.mixedInit).toBe(true);
});
it("reports truncated input rather than throwing", () => {
  const stream = bytes(init(), cluster(0, 1));
  const { report } = cleanWebm(stream.subarray(0, stream.length - 2));
  expect(report.error).toBe("truncated cluster");
});
it("detects gaps in the collected timecodes", () => {
  const whole = cleanWebm(
    bytes(init(), cluster(0, 1), cluster(10000, 2), cluster(20000, 3)),
  ).report;
  expect(contiguousCoverage(whole)).toEqual({ seconds: 30, gapped: false });
  const gapped = cleanWebm(
    bytes(init(), cluster(0, 1), cluster(10000, 2), cluster(50000, 3)),
  ).report;
  expect(contiguousCoverage(gapped).gapped).toBe(true);
});
it("round-trips PCM through base64 as normalized float samples", () => {
  const pcm = Int16Array.from([0, 16384, -16384, 32767, -32768]);
  const out = base64ToFloat32(pcmToBase64(pcm));
  expect(Array.from(out)).toEqual([0, 0.5, -0.5, 32767 / 32768, -1]);
});
it("concatenates chunks in order", () => {
  expect(
    Array.from(
      concatChunks([Uint8Array.of(1, 2), Uint8Array.of(), Uint8Array.of(3)]),
    ),
  ).toEqual([1, 2, 3]);
});

it("lists the unbuffered parts of the track, ignoring slivers", () => {
  expect(
    unbufferedGaps(
      [
        [0, 122],
        [140, 160],
        [177, 317],
      ],
      317,
    ),
  ).toEqual([
    [122, 140],
    [160, 177],
  ]);
  expect(unbufferedGaps([], 10)).toEqual([[0, 10]]);
  expect(unbufferedGaps([[0.2, 9.8]], 10)).toEqual([]);
  expect(unbufferedGaps([[5, 10]], 10)).toEqual([[0, 5]]);
  expect(unbufferedGaps([[0, 10]], 10)).toEqual([]);
});
