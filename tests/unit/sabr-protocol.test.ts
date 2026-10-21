import { expect, it } from "vitest";
import {
  replaceSabrPoToken,
  readStreamProtectionStatus,
} from "../../src/youtube/sabr-protocol";

it("replaces only the streamer-context PO Token while preserving unknown fields verbatim", () => {
  // Outer fields 1, 19 and 1000; context fields 1, 2 and 7.
  const body = new Uint8Array([
    10, 2, 8, 1, 154, 1, 10, 10, 2, 8, 2, 18, 1, 9, 58, 1, 7, 194, 62, 2, 99,
    98,
  ]);
  const saved = body.slice();
  expect([...replaceSabrPoToken(body, new Uint8Array([3, 4]))!]).toEqual([
    10, 2, 8, 1, 154, 1, 11, 10, 2, 8, 2, 18, 2, 3, 4, 58, 1, 7, 194, 62, 2, 99,
    98,
  ]);
  expect(body).toEqual(saved);
});

it("adds a missing context token and replaces duplicate tokens without changing sibling data", () => {
  const token = new Uint8Array([3]);
  expect([
    ...replaceSabrPoToken(new Uint8Array([154, 1, 2, 8, 1]), token)!,
  ]).toEqual([154, 1, 5, 8, 1, 18, 1, 3]);
  expect([
    ...replaceSabrPoToken(
      new Uint8Array([154, 1, 6, 18, 1, 7, 18, 1, 8]),
      token,
    )!,
  ]).toEqual([154, 1, 3, 18, 1, 3]);
});

it("does not reinterpret unrelated or malformed bodies as SABR requests", () => {
  for (const bytes of [
    [8, 1],
    [154, 1, 10, 8],
    [154, 1, 1, 15],
    [154, 1, 0, 154, 1, 0],
    [0],
  ])
    expect(
      replaceSabrPoToken(new Uint8Array(bytes), new Uint8Array([3])),
    ).toBeUndefined();
  expect(
    replaceSabrPoToken(new Uint8Array([154, 1, 0]), new Uint8Array()),
  ).toBeUndefined();
  expect(
    replaceSabrPoToken(
      new Uint8Array(2 * 1024 * 1024 + 1),
      new Uint8Array([3]),
    ),
  ).toBeUndefined();
  expect(
    replaceSabrPoToken(
      new Uint8Array([8, ...Array(9).fill(255), 127, 154, 1, 0]),
      new Uint8Array([3]),
    ),
  ).toBeUndefined();
});

it.each([1, 2, 3])(
  "reads UMP protection status %s even when subsequent media is incomplete",
  (status) => {
    expect(
      readStreamProtectionStatus(
        new Uint8Array([58, 4, 8, status, 16, 10, 21, 100, 0]),
      ),
    ).toBe(status);
  },
);

it("skips complete unrelated UMP parts and rejects malformed/incomplete protection data", () => {
  expect(
    readStreamProtectionStatus(new Uint8Array([20, 2, 1, 2, 58, 2, 8, 3])),
  ).toBe(3);
  for (const bytes of [
    [58, 4, 8],
    [58, 1, 8],
    [58, 2, 8, 9],
    [240],
    [21, 100, 58, 2, 8, 3],
  ])
    expect(readStreamProtectionStatus(new Uint8Array(bytes))).toBeUndefined();
});

it("uses protobuf scalar semantics for extended varints and duplicate status fields", () => {
  expect(readStreamProtectionStatus(new Uint8Array([58, 3, 8, 131, 0]))).toBe(
    3,
  );
  expect(readStreamProtectionStatus(new Uint8Array([58, 4, 8, 1, 8, 3]))).toBe(
    3,
  );
});
