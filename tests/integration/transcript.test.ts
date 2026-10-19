import { afterEach, expect, it } from "vitest";
import { readTranscriptPage } from "../../src/youtube/bridge";
afterEach(() => {
  document.body.innerHTML = "";
  history.replaceState({}, "", "/");
});
it("reads modern native transcript timestamps without requiring manual timing", async () => {
  history.replaceState({}, "", "/watch?v=12345678901");
  document.body.innerHTML = `<video></video><ytd-engagement-panel-section-list-renderer target-id="PAmodern_transcript_view" visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"><transcript-segment-view-model><div class="ytwTranscriptSegmentViewModelTimestamp">0:03</div><span role="text">第一句</span></transcript-segment-view-model><transcript-segment-view-model><div class="ytwTranscriptSegmentViewModelTimestamp">0:08</div><span role="text">第二句</span></transcript-segment-view-model></ytd-engagement-panel-section-list-renderer>`;
  Object.defineProperty(document.querySelector("video"), "duration", {
    value: 10,
  });
  expect(await readTranscriptPage("12345678901")).toMatchObject([
    { startMs: 3000, endMs: 8000, text: "第一句", endEstimated: true },
    { startMs: 8000, endMs: 10000, text: "第二句", endEstimated: true },
  ]);
});
it("rejects transcript data after navigation", async () => {
  history.replaceState({}, "", "/watch?v=other-video");
  await expect(readTranscriptPage("12345678901")).rejects.toThrow("影片已切換");
});
it("waits for a transcript entry rendered after description expansion", async () => {
  history.replaceState({}, "", "/watch?v=12345678901");
  document.body.innerHTML =
    '<video></video><div id="description-inline-expander"><button id="expand">more</button></div>';
  Object.defineProperty(document.querySelector("video"), "duration", {
    value: 10,
  });
  document.querySelector("#expand")!.addEventListener("click", () =>
    setTimeout(() => {
      const button = document.createElement("button");
      button.setAttribute("aria-label", "顯示轉錄稿");
      button.onclick = () =>
        document.body.insertAdjacentHTML(
          "beforeend",
          '<ytd-engagement-panel-section-list-renderer visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"><ytd-transcript-segment-renderer><div class="segment-start-offset">0:02</div><div class="segment-text">延遲載入</div></ytd-transcript-segment-renderer></ytd-engagement-panel-section-list-renderer>',
        );
      document.body.append(button);
    }, 20),
  );
  expect(await readTranscriptPage("12345678901")).toMatchObject([
    { startMs: 2000, text: "延遲載入", endEstimated: true },
  ]);
});
