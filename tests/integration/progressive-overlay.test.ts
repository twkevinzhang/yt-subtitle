import { afterEach, expect, it, vi } from "vitest";
import { createOverlay } from "../../src/content/overlay";
import type { AlignmentSnapshot } from "../../src/acoustic/contracts";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});
function setup() {
  let tick: FrameRequestCallback = () => {};
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    tick = fn;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const container = document.createElement("div"),
    video = document.createElement("video");
  container.append(video);
  document.body.append(container);
  let root!: ShadowRoot;
  const attach = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (
    this: Element,
    init,
  ) {
    root = attach.call(this, init);
    return root;
  });
  const overlay = createOverlay({
    container,
    video,
    videoId: "e1ZMmRlsaaU",
    isAd: () => false,
  });
  video.currentTime = 1.5;
  const snapshot: AlignmentSnapshot = {
    key: { runId: "run", tabId: 1, videoId: "e1ZMmRlsaaU", draftRevision: 1 },
    sequence: 1,
    modelState: "ready",
    segments: { s1: "verified" },
    lines: [
      {
        id: "l1",
        original: "ready",
        startMs: 1000,
        endMs: 2000,
        cueIds: [],
        status: "estimated",
        excluded: false,
      },
      {
        id: "l2",
        original: "pending",
        cueIds: [],
        status: "unaligned",
        excluded: false,
      },
    ],
  };
  return {
    overlay,
    snapshot,
    text: () => {
      tick(0);
      return root.textContent;
    },
  };
}
it("previews ready lines without requiring pending lines to be excluded", () => {
  const { overlay, snapshot, text } = setup();
  overlay.beginDraft(snapshot.key);
  overlay.setDraftPreview(snapshot, "original");
  expect(text()).toBe("ready");
  overlay.destroy();
});
it("rejects old revision/sequence and clears draft on stop", () => {
  const { overlay, snapshot, text } = setup();
  overlay.beginDraft(snapshot.key);
  overlay.setDraftPreview(snapshot, "original");
  expect(() =>
    overlay.setDraftPreview(
      { ...snapshot, key: { ...snapshot.key, draftRevision: 0 } },
      "original",
    ),
  ).toThrow();
  overlay.setDraftPreview({ ...snapshot, sequence: 0, lines: [] }, "original");
  expect(text()).toBe("ready");
  overlay.stop();
  expect(text()).toBe("");
  overlay.destroy();
});
it("does not substitute original text for unavailable translations", () => {
  const { overlay, snapshot, text } = setup();
  overlay.beginDraft(snapshot.key);
  overlay.setDraftPreview(snapshot, "translation");
  expect(text()).toBe("");
  overlay.destroy();
});
it("applies a restored draft offset to playback", () => {
  const { overlay, snapshot, text } = setup();
  overlay.beginDraft(snapshot.key);
  overlay.setDraftPreview(snapshot, "original", undefined, 1000);
  expect(text()).toBe("");
  document.querySelector("video")!.currentTime = 2.5;
  expect(text()).toBe("ready");
  overlay.destroy();
});
