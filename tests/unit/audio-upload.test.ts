import { expect, it } from "vitest";
import { AudioUploads, AudioStaging } from "../../src/background/audio-uploads";

it("accepts ordered compressed chunks only from their owning video/tab", () => {
  const uploads = new AudioUploads();
  const id = uploads.begin(1, "video", 100);
  expect(() => uploads.append(id, 2, "video", 0, "AQID")).toThrow();
  expect(() => uploads.append(id, 1, "other", 0, "AQID")).toThrow();
  expect(() => uploads.append(id, 1, "video", 1, "AQID")).toThrow();
  uploads.append(id, 1, "video", 0, "AQID");
  expect(new Uint8Array(uploads.finish(id, 1, "video"))).toEqual(
    new Uint8Array([1, 2, 3]),
  );
  expect(() => uploads.finish(id, 1, "video")).toThrow();
});
it("expires abandoned uploads and drops them on cancellation/navigation", () => {
  let now = 0;
  const uploads = new AudioUploads(() => now);
  const id = uploads.begin(1, "video", 100);
  now = 91000;
  expect(() => uploads.append(id, 1, "video", 0, "AQID")).toThrow();
  const next = uploads.begin(1, "video", 100);
  uploads.clearTab(1);
  expect(() => uploads.finish(next, 1, "video")).toThrow();
});
it("bounds concurrent uploads and rejects decoded or oversized payloads", () => {
  const uploads = new AudioUploads();
  const id = uploads.begin(1, "video", 2);
  expect(() => uploads.begin(2, "other")).toThrow();
  expect(() => uploads.append(id, 1, "video", 0, "AQID")).toThrow();
});
it("holds the reservation while staging and removes an asset written after cancellation", async () => {
  const removed: string[] = [],
    staging = new AudioStaging(async (id) => {
      removed.push(id);
    });
  let finish!: () => void;
  const writing = staging.put(
    "a",
    1,
    "video",
    async () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const rejected = expect(writing).rejects.toThrow("取消");
  expect(staging.isBusy).toBe(true);
  await expect(staging.put("b", 2, "other", async () => {})).rejects.toThrow();
  await staging.clearTab(1);
  expect(staging.isBusy).toBe(false);
  await staging.put("b", 2, "other", async () => {});
  finish();
  await rejected;
  expect(removed.filter((id) => id === "a")).toHaveLength(2);
  expect(staging.claim("b", 2, "other")).toBe(true);
});
