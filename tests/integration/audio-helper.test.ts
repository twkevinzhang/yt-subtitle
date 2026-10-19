import { afterEach, beforeEach, expect, it, vi } from "vitest";

class BufferMock extends EventTarget {
  buffered = { length: 1, start: () => 0, end: () => 10 };
  appendBuffer = vi.fn();
  changeType = vi.fn();
}
class MediaSourceMock {
  addSourceBuffer(_mime: string) {
    return new BufferMock();
  }
}
const originalAddSourceBuffer = MediaSourceMock.prototype.addSourceBuffer;
const send = vi.fn();
let index = 0;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  document.body.innerHTML = '<video></video><div id="movie_player"></div>';
  vi.spyOn(document.querySelector("video")!, "pause").mockImplementation(
    () => {},
  );
  vi.stubGlobal("location", {
    href: "https://www.youtube.com/watch?v=12345678901&ai-lyrics-audio=00000000-0000-0000-0000-000000000001",
    hostname: "www.youtube.com",
    origin: "https://www.youtube.com",
  });
  vi.stubGlobal("parent", { postMessage: send });
  vi.stubGlobal("MediaSource", MediaSourceMock);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL(_obj: unknown) {
        return `blob:https://www.youtube.com/${++index}`;
      }
    },
  );
  send.mockClear();
});
afterEach(() => {
  MediaSourceMock.prototype.addSourceBuffer = originalAddSourceBuffer;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

it("ignores a second audio SourceBuffer on an unattached MediaSource", async () => {
  await import("../../src/youtube/audio-helper");
  const active = new MediaSourceMock();
  document.querySelector("video")!.src = URL.createObjectURL(active as any);
  const first = active.addSourceBuffer("audio/webm");
  first.appendBuffer(new Uint8Array([1]));
  const unused = new MediaSourceMock().addSourceBuffer("audio/mp4");
  unused.appendBuffer(new Uint8Array([2]));
  expect(send.mock.calls.map((c) => c[0].type)).toEqual(["chunk"]);
});
it("resets captured chunks on an actual player source replacement and ignores stale callbacks", async () => {
  await import("../../src/youtube/audio-helper");
  const one = new MediaSourceMock(),
    two = new MediaSourceMock();
  document.querySelector("video")!.src = URL.createObjectURL(one as any);
  const a = one.addSourceBuffer("audio/webm");
  a.appendBuffer(new Uint8Array([1]));
  const b = two.addSourceBuffer("audio/mp4");
  document.querySelector("video")!.src = URL.createObjectURL(two as any);
  b.appendBuffer(new Uint8Array([2]));
  a.appendBuffer(new Uint8Array([3]));
  a.dispatchEvent(new Event("updateend"));
  b.dispatchEvent(new Event("updateend"));
  expect(send.mock.calls.map((c) => c[0].type)).toEqual([
    "chunk",
    "reset",
    "chunk",
    "coverage",
  ]);
  expect(Array.from(new Uint8Array(send.mock.calls[2][0].data))).toEqual([2]);
});
it("ignores changeType on a detached source before the replacement's first append", async () => {
  await import("../../src/youtube/audio-helper");
  const one = new MediaSourceMock(),
    two = new MediaSourceMock();
  document.querySelector("video")!.src = URL.createObjectURL(one as any);
  const a = one.addSourceBuffer("audio/webm");
  a.appendBuffer(new Uint8Array([1]));
  document.querySelector("video")!.src = URL.createObjectURL(two as any);
  a.changeType("audio/mp4");
  expect(send.mock.calls.map((c) => c[0].type)).toEqual(["chunk"]);
});
it("does not complete from the old source's coverage after the player attaches a new source", async () => {
  await import("../../src/youtube/audio-helper");
  const video = document.querySelector("video")!;
  Object.defineProperty(video, "duration", { value: 10 });
  Object.assign(document.querySelector("#movie_player")!, {
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    seekTo: vi.fn(),
  });
  const one = new MediaSourceMock(),
    two = new MediaSourceMock();
  video.src = URL.createObjectURL(one as any);
  const a = one.addSourceBuffer("audio/webm");
  a.appendBuffer(new Uint8Array([1]));
  a.dispatchEvent(new Event("updateend"));
  video.src = URL.createObjectURL(two as any);
  vi.advanceTimersByTime(200);
  expect(send.mock.calls.map((c) => c[0].type)).not.toContain("complete");
});
it("stops after two actual source restarts instead of retrying indefinitely", async () => {
  await import("../../src/youtube/audio-helper");
  for (let i = 0; i < 4; i++) {
    const source = new MediaSourceMock();
    document.querySelector("video")!.src = URL.createObjectURL(source as any);
    source.addSourceBuffer("audio/webm").appendBuffer(new Uint8Array([i]));
  }
  expect(send.mock.calls.filter((c) => c[0].type === "reset")).toHaveLength(2);
  expect(send.mock.calls.at(-1)![0]).toMatchObject({
    type: "error",
    message: "音訊來源持續切換，歌詞已保留",
  });
});
it("still rejects a genuine codec change in the currently captured SourceBuffer", async () => {
  await import("../../src/youtube/audio-helper");
  const source = new MediaSourceMock();
  document.querySelector("video")!.src = URL.createObjectURL(source as any);
  const buffer = source.addSourceBuffer("audio/webm");
  buffer.appendBuffer(new Uint8Array([1]));
  buffer.changeType("audio/mp4");
  expect(send.mock.calls.at(-1)![0].type).toBe("error");
});
