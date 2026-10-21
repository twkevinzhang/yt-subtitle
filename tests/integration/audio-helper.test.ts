import { afterEach, beforeEach, expect, it, vi } from "vitest";

class BufferMock extends EventTarget {
  buffered = { length: 1, start: () => 0, end: () => 10 };
  appendBuffer = vi.fn();
  abort = vi.fn();
  remove = vi.fn();
  changeType = vi.fn();
}
class MediaSourceMock {
  addSourceBuffer(_mime: string) {
    return new BufferMock();
  }
}
const originalAddSourceBuffer = MediaSourceMock.prototype.addSourceBuffer;
const send = vi.fn();
it("clears a pending Token deadline when the helper fails before authorization", async () => {
  (location as any).href += "&ai-lyrics-stream=1";
  const originalFetch = window.fetch;
  await import("../../src/youtube/audio-helper");
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "https://rr.example.googlevideo.com/videoplayback");
  xhr.send(new Uint8Array([154, 1, 3, 18, 1, 9]));
  expect(send.mock.calls.some((c) => c[0].type === "token-needed")).toBe(true);
  const source = new MediaSourceMock();
  document.querySelector("video")!.src = URL.createObjectURL(source as any);
  const buffer = source.addSourceBuffer("audio/webm");
  buffer.appendBuffer(init);
  buffer.changeType("audio/mp4");
  await Promise.resolve();
  await Promise.resolve();
  expect(send.mock.calls.some((c) => c[0].type === "error")).toBe(true);
  expect(window.fetch).toBe(originalFetch);
  expect(vi.getTimerCount()).toBe(0);
});
it("does not apply the PCM progress watchdog before initial content exists, but retains its hard range deadline", async () => {
  (location as any).href += "&ai-lyrics-stream=1";
  await import("../../src/youtube/audio-helper");
  Object.assign(document.querySelector("#movie_player")!, {
    playVideo: vi.fn(),
  });
  window.dispatchEvent(
    new MessageEvent("message", {
      source: parent,
      origin: "https://www.youtube.com",
      data: {
        tag: "ai-lyrics-control",
        nonce: "00000000-0000-0000-0000-000000000001",
        action: "range",
        range: { startMs: 192000, endMs: 218000 },
      },
    }),
  );
  vi.advanceTimersByTime(16000);
  expect(send.mock.calls.some((c) => c[0].type === "error")).toBe(false);
  vi.advanceTimersByTime(74000);
  expect(send.mock.calls.find((c) => c[0].type === "error")?.[0].code).toBe(
    "deadline",
  );
});
it("emits MIME, generation and chunk sequence for incremental decoding", async () => {
  await import("../../src/youtube/audio-helper");
  const source = new MediaSourceMock();
  document.querySelector("video")!.src = URL.createObjectURL(source as any);
  const buffer = source.addSourceBuffer('audio/webm; codecs="opus"');
  buffer.appendBuffer(init);
  buffer.appendBuffer(new Uint8Array([2]));
  expect(send.mock.calls[0][0]).toMatchObject({
    mime: 'audio/webm; codecs="opus"',
    generation: 0,
    sequence: 0,
    init: true,
  });
  expect(send.mock.calls[1][0]).toMatchObject({
    generation: 0,
    sequence: 1,
    init: false,
  });
});
it("arms the 15-second watchdog when verified content first arrives after loading", async () => {
  (location as any).href += "&ai-lyrics-stream=1";
  await import("../../src/youtube/audio-helper");
  Object.assign(document.querySelector("#movie_player")!, {
    playVideo: vi.fn(),
  });
  vi.advanceTimersByTime(20000);
  expect(send.mock.calls.some((c) => c[0].type === "error")).toBe(false);
  const source = new MediaSourceMock();
  document.querySelector("video")!.src = URL.createObjectURL(source as any);
  source.addSourceBuffer("audio/webm").appendBuffer(init);
  vi.advanceTimersByTime(16000);
  expect(send.mock.calls.find((c) => c[0].type === "error")?.[0].code).toBe(
    "no-progress",
  );
});
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
  first.appendBuffer(init);
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
  a.appendBuffer(init);
  const b = two.addSourceBuffer("audio/webm");
  document.querySelector("video")!.src = URL.createObjectURL(two as any);
  b.appendBuffer(init);
  a.appendBuffer(new Uint8Array([3]));
  a.dispatchEvent(new Event("updateend"));
  b.dispatchEvent(new Event("updateend"));
  expect(send.mock.calls.map((c) => c[0].type)).toEqual([
    "chunk",
    "reset",
    "chunk",
    "coverage",
  ]);
  expect(Array.from(new Uint8Array(send.mock.calls[2][0].data))).toEqual([
    ...init,
  ]);
});
it("ignores changeType on a detached source before the replacement's first append", async () => {
  await import("../../src/youtube/audio-helper");
  const one = new MediaSourceMock(),
    two = new MediaSourceMock();
  document.querySelector("video")!.src = URL.createObjectURL(one as any);
  const a = one.addSourceBuffer("audio/webm");
  a.appendBuffer(init);
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
  a.appendBuffer(init);
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
    source.addSourceBuffer("audio/webm").appendBuffer(init);
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
  buffer.appendBuffer(init);
  buffer.changeType("audio/mp4");
  expect(send.mock.calls.at(-1)![0].type).toBe("error");
});

function playerState() {
  const video = document.querySelector("video")!;
  const player = document.querySelector("#movie_player")!;
  const playVideo = vi.fn(),
    seekTo = vi.fn();
  Object.assign(player, {
    playVideo,
    seekTo,
    getVideoData: () => ({ video_id: "12345678901" }),
  });
  return { video, player, playVideo, seekTo };
}
// Minimal EBML header + Segment + Tracks with one clear Opus audio track.
const init = new Uint8Array([
  0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67, 0xff, 0x16, 0x54, 0xae,
  0x6b, 0x8a, 0xae, 0x88, 0x83, 0x81, 0x02, 0x86, 0x83, 0x41, 0x5f, 0x4f,
]);
it("waits through ads without capturing, seeking, pausing or the 15s idle failure", async () => {
  await import("../../src/youtube/audio-helper");
  const { video, player, playVideo, seekTo } = playerState();
  player.classList.add("ad-showing");
  const source = new MediaSourceMock();
  video.src = URL.createObjectURL(source as any);
  const buffer = source.addSourceBuffer("audio/webm");
  buffer.appendBuffer(new Uint8Array([9, 9]));
  buffer.dispatchEvent(new Event("updateend"));
  vi.advanceTimersByTime(20000);
  expect(send.mock.calls.map((c) => c[0].type)).not.toContain("error");
  expect(send.mock.calls.map((c) => c[0].type)).not.toContain("chunk");
  expect(send.mock.calls.map((c) => c[0].type)).not.toContain("coverage");
  expect(send.mock.calls.some((c) => c[0].state === "waiting-ad")).toBe(true);
  expect(playVideo).toHaveBeenCalled();
  expect(seekTo).not.toHaveBeenCalled();
  expect(video.pause).not.toHaveBeenCalled();
});
it("keeps the 90s total deadline even during an ad", async () => {
  await import("../../src/youtube/audio-helper");
  const { player } = playerState();
  player.classList.add("ad-interrupting");
  vi.advanceTimersByTime(90200);
  expect(send.mock.calls.at(-1)![0]).toMatchObject({
    type: "error",
    code: "deadline",
  });
});
it("resumes a new content source only after identity and fresh initialization are verified", async () => {
  await import("../../src/youtube/audio-helper");
  const { video, player, seekTo } = playerState();
  const adSource = new MediaSourceMock();
  video.src = URL.createObjectURL(adSource as any);
  player.classList.add("ad-showing");
  adSource.addSourceBuffer("audio/webm").appendBuffer(new Uint8Array([9]));
  vi.advanceTimersByTime(20000);
  player.classList.remove("ad-showing");
  const source = new MediaSourceMock();
  video.src = URL.createObjectURL(source as any);
  const buffer = source.addSourceBuffer("audio/webm");
  buffer.appendBuffer(new Uint8Array([0x1f, 0x43])); // no initialization: never capture
  expect(send.mock.calls.filter((c) => c[0].type === "chunk")).toHaveLength(0);
  buffer.appendBuffer(init);
  const chunks = send.mock.calls.filter((c) => c[0].type === "chunk");
  expect(chunks).toHaveLength(1);
  expect(chunks[0][0]).toMatchObject({
    init: true,
    sequence: 0,
    generation: 1,
  });
  expect(Array.from(new Uint8Array(chunks[0][0].data))).toEqual(
    Array.from(init),
  );
  vi.advanceTimersByTime(200);
  expect(seekTo).toHaveBeenCalledWith(0, true);
});
it("does not infer encrypted audio from a mediaKeys attachment", async () => {
  await import("../../src/youtube/audio-helper");
  const { video } = playerState();
  Object.defineProperty(video, "mediaKeys", { value: {} });
  const source = new MediaSourceMock();
  video.src = URL.createObjectURL(source as any);
  source.addSourceBuffer("audio/webm").appendBuffer(init);
  expect(send.mock.calls.some((c) => c[0].type === "error")).toBe(false);
  expect(send.mock.calls.some((c) => c[0].type === "chunk")).toBe(true);
});
it("rejects a wrong video identity after an ad and ignores stale coverage callbacks", async () => {
  await import("../../src/youtube/audio-helper");
  const { video, player } = playerState();
  const old = new MediaSourceMock();
  video.src = URL.createObjectURL(old as any);
  const buffer = old.addSourceBuffer("audio/webm");
  buffer.appendBuffer(init);
  player.classList.add("ad-showing");
  vi.advanceTimersByTime(200);
  player.classList.remove("ad-showing");
  Object.assign(player, { getVideoData: () => ({ video_id: "wrong" }) });
  send.mockClear();
  buffer.dispatchEvent(new Event("updateend"));
  buffer.appendBuffer(init);
  expect(
    send.mock.calls.some((c) =>
      ["chunk", "coverage", "complete"].includes(c[0].type),
    ),
  ).toBe(false);
});
it("does not count pre-ad buffered ranges when the same SourceBuffer is reused", async () => {
  await import("../../src/youtube/audio-helper");
  const { video, player } = playerState();
  const source = new MediaSourceMock();
  video.src = URL.createObjectURL(source as any);
  const buffer = source.addSourceBuffer("audio/webm");
  buffer.appendBuffer(init);
  player.classList.add("ad-showing");
  vi.advanceTimersByTime(200);
  buffer.appendBuffer(new Uint8Array([9])); // This buffer actually received ad data.
  player.classList.remove("ad-showing");
  send.mockClear();
  buffer.appendBuffer(init);
  buffer.dispatchEvent(new Event("updateend"));
  expect(
    send.mock.calls.some((c) =>
      ["chunk", "coverage", "complete"].includes(c[0].type),
    ),
  ).toBe(false);
});
it("does not claim complete from retained pre-ad ranges without recapturing matching bytes", async () => {
  await import("../../src/youtube/audio-helper");
  const { video, player } = playerState();
  const source = new MediaSourceMock();
  video.src = URL.createObjectURL(source as any);
  const buffer = source.addSourceBuffer("audio/webm");
  buffer.appendBuffer(init);
  player.classList.add("ad-showing");
  vi.advanceTimersByTime(200);
  player.classList.remove("ad-showing");
  send.mockClear();
  buffer.appendBuffer(new Uint8Array([0x1f, 0x43, 0xb6, 0x75]));
  const chunks = send.mock.calls.filter((c) => c[0].type === "chunk");
  expect(chunks).toHaveLength(0);
  Object.defineProperty(video, "duration", { value: 10 });
  buffer.dispatchEvent(new Event("updateend"));
  vi.advanceTimersByTime(400);
  expect(
    send.mock.calls.some((c) => ["coverage", "complete"].includes(c[0].type)),
  ).toBe(false);
});
it("joins a split fresh initialization after an ad", async () => {
  await import("../../src/youtube/audio-helper");
  const { video, player } = playerState();
  player.classList.add("ad-showing");
  vi.advanceTimersByTime(200);
  player.classList.remove("ad-showing");
  const source = new MediaSourceMock();
  video.src = URL.createObjectURL(source as any);
  const buffer = source.addSourceBuffer("audio/webm");
  buffer.appendBuffer(init.slice(0, 3));
  buffer.appendBuffer(init.slice(3));
  const chunks = send.mock.calls.filter((c) => c[0].type === "chunk");
  expect(chunks).toHaveLength(1);
  expect(chunks[0][0].data.byteLength).toBe(init.length);
});
it("diagnoses encrypted audio metadata separately from ad waiting", async () => {
  await import("../../src/youtube/audio-helper");
  const { video } = playerState();
  const source = new MediaSourceMock();
  video.src = URL.createObjectURL(source as any);
  const buffer = source.addSourceBuffer("audio/webm");
  const encrypted = new Uint8Array([
    ...init.slice(0, 14),
    0x95,
    0xae,
    0x93,
    ...init.slice(17),
    0x6d,
    0x80,
    0x88,
    0x62,
    0x40,
    0x85,
    0x50,
    0x35,
    0x80,
    0xec,
    0x80,
  ]);
  buffer.appendBuffer(encrypted);
  expect(send.mock.calls.at(-1)![0]).toMatchObject({
    type: "error",
    code: "encrypted-audio",
  });
  expect(send.mock.calls.some((c) => c[0].type === "chunk")).toBe(false);
});
it("rejects split encrypted initialization before forwarding any bytes", async () => {
  await import("../../src/youtube/audio-helper");
  const { video } = playerState();
  Object.defineProperty(video, "mediaKeys", { value: {} });
  const source = new MediaSourceMock();
  video.src = URL.createObjectURL(source as any);
  const buffer = source.addSourceBuffer("audio/webm");
  const encrypted = new Uint8Array([
    ...init.slice(0, 14),
    0x95,
    0xae,
    0x93,
    ...init.slice(17),
    0x6d,
    0x80,
    0x88,
    0x62,
    0x40,
    0x85,
    0x50,
    0x35,
    0x80,
    0xec,
    0x80,
  ]);
  buffer.appendBuffer(encrypted.slice(0, 18));
  expect(send.mock.calls.some((c) => c[0].type === "chunk")).toBe(false);
  buffer.appendBuffer(encrypted.slice(18));
  expect(send.mock.calls.at(-1)![0]).toMatchObject({
    type: "error",
    code: "encrypted-audio",
  });
  expect(send.mock.calls.some((c) => c[0].type === "chunk")).toBe(false);
});
it("observes ad state before processing changeType even before the next timer tick", async () => {
  await import("../../src/youtube/audio-helper");
  const { video, player } = playerState();
  const source = new MediaSourceMock();
  video.src = URL.createObjectURL(source as any);
  const buffer = source.addSourceBuffer("audio/webm");
  buffer.appendBuffer(init);
  player.classList.add("ad-showing");
  buffer.changeType("audio/mp4");
  expect(send.mock.calls.some((c) => c[0].type === "error")).toBe(false);
  expect(send.mock.calls.some((c) => c[0].state === "waiting-ad")).toBe(true);
});
it("waits for decoded-range acknowledgement before parking a streaming helper", async () => {
  (location as any).href += "&ai-lyrics-stream=1";
  await import("../../src/youtube/audio-helper");
  const { video, player } = playerState();
  const pauseVideo = vi.fn();
  Object.assign(player, { pauseVideo });
  Object.defineProperty(video, "duration", { value: 10 });
  const source = new MediaSourceMock();
  video.src = URL.createObjectURL(source as any);
  source.addSourceBuffer("audio/webm").appendBuffer(init);
  window.dispatchEvent(
    new MessageEvent("message", {
      source: parent,
      origin: "https://www.youtube.com",
      data: {
        tag: "ai-lyrics-control",
        nonce: "00000000-0000-0000-0000-000000000001",
        action: "range",
        range: { startMs: 0, endMs: 1000 },
      },
    }),
  );
  vi.advanceTimersByTime(400);
  expect(pauseVideo).not.toHaveBeenCalled();
  window.dispatchEvent(
    new MessageEvent("message", {
      source: parent,
      origin: "https://www.youtube.com",
      data: {
        tag: "ai-lyrics-control",
        nonce: "00000000-0000-0000-0000-000000000001",
        action: "pause",
      },
    }),
  );
  vi.advanceTimersByTime(200);
  expect(pauseVideo).toHaveBeenCalled();
  expect(send.mock.calls.some((c) => c[0].type === "complete")).toBe(false);
  vi.advanceTimersByTime(20000);
  expect(send.mock.calls.some((c) => c[0].type === "error")).toBe(false);
});
it("announces streaming readiness and keeps a completed range parked on duplicate load commands", async () => {
  (location as any).href += "&ai-lyrics-stream=1";
  await import("../../src/youtube/audio-helper");
  const { player, seekTo } = playerState();
  const pauseVideo = vi.fn();
  Object.assign(player, { pauseVideo });
  const command = (action: string) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: parent,
        origin: "https://www.youtube.com",
        data: {
          tag: "ai-lyrics-control",
          nonce: "00000000-0000-0000-0000-000000000001",
          action,
          range: { startMs: 0, endMs: 26000 },
        },
      }),
    );
  command("range");
  command("pause");
  command("range"); // iframe load can finish after early chunks have already satisfied the range
  vi.advanceTimersByTime(16000);
  expect(pauseVideo).toHaveBeenCalled();
  expect(seekTo).not.toHaveBeenCalled();
  expect(send.mock.calls.some((c) => c[0].type === "error")).toBe(false);
  expect(send.mock.calls.some((c) => c[0].type === "ready")).toBe(true);
});
it("advances a streaming request only to captured content so native fetching can continue beyond its initial buffer", async () => {
  (location as any).href += "&ai-lyrics-stream=1";
  await import("../../src/youtube/audio-helper");
  const { video, seekTo, player } = playerState();
  const source = new MediaSourceMock();
  video.src = URL.createObjectURL(source as any);
  const buffer = source.addSourceBuffer("audio/webm");
  buffer.buffered = { length: 1, start: () => 0, end: () => 20 };
  buffer.appendBuffer(init);
  buffer.dispatchEvent(new Event("updateend"));
  window.dispatchEvent(
    new MessageEvent("message", {
      source: parent,
      origin: "https://www.youtube.com",
      data: {
        tag: "ai-lyrics-control",
        nonce: "00000000-0000-0000-0000-000000000001",
        action: "range",
        range: { startMs: 0, endMs: 26000 },
      },
    }),
  );
  vi.advanceTimersByTime(400);
  expect(seekTo).toHaveBeenCalledWith(19.85, true);
  expect(seekTo.mock.calls.every((c) => c[0] < 20)).toBe(true);
  seekTo.mockClear();
  player.classList.add("ad-showing");
  vi.advanceTimersByTime(600);
  expect(seekTo).not.toHaveBeenCalled();
});
it("reports verified content EOF before idle failure but never reports an ad ending", async () => {
  (location as any).href += "&ai-lyrics-stream=1";
  await import("../../src/youtube/audio-helper");
  const { video, player } = playerState();
  Object.defineProperties(video, {
    duration: { value: 10 },
    ended: { value: true },
  });
  const source = new MediaSourceMock();
  video.src = URL.createObjectURL(source as any);
  const buffer = source.addSourceBuffer("audio/webm");
  buffer.appendBuffer(init);
  buffer.dispatchEvent(new Event("updateend"));
  window.dispatchEvent(
    new MessageEvent("message", {
      source: parent,
      origin: "https://www.youtube.com",
      data: {
        tag: "ai-lyrics-control",
        nonce: "00000000-0000-0000-0000-000000000001",
        action: "range",
        range: { startMs: 0, endMs: 10000 },
      },
    }),
  );
  vi.advanceTimersByTime(16000);
  expect(send.mock.calls.filter((c) => c[0].type === "eof")).toHaveLength(1);
  expect(send.mock.calls.some((c) => c[0].type === "error")).toBe(false);
  player.classList.add("ad-showing");
  vi.advanceTimersByTime(400);
  expect(send.mock.calls.filter((c) => c[0].type === "eof")).toHaveLength(1);
});
it("keeps the next append pending when YouTube appends inside its earlier updateend listener", async () => {
  (location as any).href += "&ai-lyrics-stream=1";
  MediaSourceMock.prototype.addSourceBuffer = function () {
    const buffer = new BufferMock() as BufferMock & { updating: boolean };
    buffer.updating = false;
    buffer.buffered = { length: 1, start: () => 0, end: () => 5 };
    let next = false;
    buffer.addEventListener("updateend", () => {
      if (next) return;
      next = true;
      buffer.updating = true;
      buffer.appendBuffer(new Uint8Array([2]));
    });
    return buffer;
  };
  await import("../../src/youtube/audio-helper");
  const { video } = playerState();
  Object.defineProperty(video, "duration", { value: 10 });
  const source = new MediaSourceMock();
  video.src = URL.createObjectURL(source as any);
  const buffer = source.addSourceBuffer("audio/webm") as BufferMock & {
    updating: boolean;
  };
  buffer.appendBuffer(init);
  window.dispatchEvent(
    new MessageEvent("message", {
      source: parent,
      origin: "https://www.youtube.com",
      data: {
        tag: "ai-lyrics-control",
        nonce: "00000000-0000-0000-0000-000000000001",
        action: "range",
        range: { startMs: 0, endMs: 10000 },
      },
    }),
  );
  buffer.dispatchEvent(new Event("updateend"));
  buffer.buffered = { length: 1, start: () => 0, end: () => 10 };
  buffer.updating = false;
  buffer.dispatchEvent(new Event("updateend"));
  vi.advanceTimersByTime(400);
  expect(send.mock.calls.filter((c) => c[0].type === "tail")).toHaveLength(1);
});
it("announces a verified native tail even if YouTube leaves MediaSource open without ended", async () => {
  (location as any).href += "&ai-lyrics-stream=1";
  await import("../../src/youtube/audio-helper");
  const { video, player } = playerState();
  Object.defineProperties(video, {
    duration: { value: 10 },
    ended: { value: false },
  });
  const source = new MediaSourceMock();
  video.src = URL.createObjectURL(source as any);
  const buffer = source.addSourceBuffer("audio/webm");
  buffer.appendBuffer(init);
  buffer.dispatchEvent(new Event("updateend"));
  window.dispatchEvent(
    new MessageEvent("message", {
      source: parent,
      origin: "https://www.youtube.com",
      data: {
        tag: "ai-lyrics-control",
        nonce: "00000000-0000-0000-0000-000000000001",
        action: "range",
        range: { startMs: 0, endMs: 10000 },
      },
    }),
  );
  vi.advanceTimersByTime(600);
  expect(send.mock.calls.filter((c) => c[0].type === "tail")).toHaveLength(1);
  expect(send.mock.calls.some((c) => c[0].type === "eof")).toBe(false);
  player.classList.add("ad-showing");
  vi.advanceTimersByTime(400);
  expect(send.mock.calls.filter((c) => c[0].type === "tail")).toHaveLength(1);
});
it("forwards parser reset only for the verified attached content buffer", async () => {
  (location as any).href += "&ai-lyrics-stream=1";
  await import("../../src/youtube/audio-helper");
  const { video, player } = playerState();
  const source = new MediaSourceMock();
  video.src = URL.createObjectURL(source as any);
  const buffer = source.addSourceBuffer("audio/webm");
  buffer.appendBuffer(init);
  buffer.abort();
  expect(
    send.mock.calls.filter((c) => c[0].type === "discontinuity"),
  ).toHaveLength(1);
  new MediaSourceMock().addSourceBuffer("audio/webm").abort();
  player.classList.add("ad-showing");
  buffer.abort();
  expect(
    send.mock.calls.filter((c) => c[0].type === "discontinuity"),
  ).toHaveLength(1);
});
it("does not remove a partially buffered request while waiting for its new suffix", async () => {
  (location as any).href += "&ai-lyrics-stream=1";
  await import("../../src/youtube/audio-helper");
  const { video, seekTo } = playerState();
  const source = new MediaSourceMock();
  video.src = URL.createObjectURL(source as any);
  const buffer = source.addSourceBuffer("audio/webm");
  buffer.appendBuffer(init);
  buffer.dispatchEvent(new Event("updateend"));
  window.dispatchEvent(
    new MessageEvent("message", {
      source: parent,
      origin: "https://www.youtube.com",
      data: {
        tag: "ai-lyrics-control",
        nonce: "00000000-0000-0000-0000-000000000001",
        action: "range",
        range: { startMs: 9900, endMs: 20000 },
      },
    }),
  );
  vi.advanceTimersByTime(400);
  expect(buffer.remove).not.toHaveBeenCalled();
  expect(seekTo).toHaveBeenCalledWith(9.9, true);
});
it("refetches an uncaptured nonzero request once instead of seeking over retained native audio", async () => {
  (location as any).href += "&ai-lyrics-stream=1";
  await import("../../src/youtube/audio-helper");
  const { video, player, seekTo } = playerState();
  const source = new MediaSourceMock();
  video.src = URL.createObjectURL(source as any);
  const buffer = source.addSourceBuffer("audio/webm");
  buffer.appendBuffer(init);
  buffer.dispatchEvent(new Event("updateend"));
  const command = () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: parent,
        origin: "https://www.youtube.com",
        data: {
          tag: "ai-lyrics-control",
          nonce: "00000000-0000-0000-0000-000000000001",
          action: "range",
          range: { startMs: 8000, endMs: 10000 },
        },
      }),
    );
  command();
  player.classList.add("ad-showing");
  vi.advanceTimersByTime(400);
  expect(buffer.remove).not.toHaveBeenCalled();
  player.classList.remove("ad-showing");
  // A fresh source after the ad must pass initialization before refetching.
  const fresh = new MediaSourceMock();
  video.src = URL.createObjectURL(fresh as any);
  const content = fresh.addSourceBuffer("audio/webm");
  Object.assign(player, { getVideoData: () => ({ video_id: "12345678901" }) });
  content.appendBuffer(init);
  content.dispatchEvent(new Event("updateend"));
  vi.advanceTimersByTime(600);
  expect(content.remove).toHaveBeenCalledExactlyOnceWith(8, 10);
  expect(seekTo).toHaveBeenCalledWith(8, true);
  command();
  vi.advanceTimersByTime(400);
  expect(content.remove).toHaveBeenCalledTimes(1);
  expect(seekTo.mock.calls.every((c) => c[0] === 8)).toBe(true);
});
