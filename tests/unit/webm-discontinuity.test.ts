import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { WebmDemuxer } from "../../src/acoustic/webm-demuxer";

it("drops unfinished container bytes only at an explicit native parser reset", () => {
  const data = new Uint8Array(readFileSync("tests/fixtures/audio/tone.webm"));
  const marker = [0x1f, 0x43, 0xb6, 0x75];
  const cluster = data.findIndex((_, i) =>
    marker.every((b, j) => data[i + j] === b),
  );
  expect(cluster).toBeGreaterThan(0);
  const packets: unknown[] = [];
  const demux = new WebmDemuxer(
    () => {},
    (p) => packets.push(p),
  );
  demux.push(data.slice(0, cluster + 35));
  demux.discontinuity();
  demux.push(data.slice(cluster));
  expect(packets.length).toBeGreaterThan(5);
});
it("accepts a new native append media segment without concatenating an unfinished old leaf", () => {
  const data = new Uint8Array(readFileSync("tests/fixtures/audio/tone.webm"));
  const cluster = data.findIndex((_, i) =>
    [0x1f, 0x43, 0xb6, 0x75].every((b, j) => data[i + j] === b),
  );
  const packets: unknown[] = [];
  const demux = new WebmDemuxer(
    () => {},
    (p) => packets.push(p),
  );
  demux.push(data.slice(0, cluster + 35), true);
  demux.push(data.slice(cluster), true);
  expect(packets.length).toBeGreaterThan(5);
});
it("allows an identical initialization replay only at a native append boundary", () => {
  const data = new Uint8Array(readFileSync("tests/fixtures/audio/tone.webm"));
  const packets: unknown[] = [];
  let tracks = 0;
  const demux = new WebmDemuxer(
    () => tracks++,
    (p) => packets.push(p),
  );
  demux.push(data, true);
  const before = packets.length;
  demux.push(data, true);
  expect(packets.length).toBe(before * 2);
  expect(tracks).toBe(1);
  const changed = data.slice();
  const head = changed.findIndex((_, i) =>
    [79, 112, 117, 115, 72, 101, 97, 100].every((b, j) => changed[i + j] === b),
  );
  changed[head + 9] = changed[head + 9] === 1 ? 2 : 1;
  expect(() => demux.push(changed, true)).toThrow(/音軌/);
});
