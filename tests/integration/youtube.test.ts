import { it, expect } from "vitest";
import { validateCaptionUrl, chooseTracks } from "../../src/youtube/context";
import { currentBinding } from "../../src/youtube/lifecycle";
it("rejects forged arbitrary fetch URLs", () => {
  expect(() => validateCaptionUrl("https://evil.test/api")).toThrow();
  expect(() =>
    validateCaptionUrl("https://www.youtube.com/api/timedtext?x=1"),
  ).not.toThrow();
});
it("prefers original manual captions without deleting automatic choice", () =>
  expect(
    chooseTracks([
      { id: "auto", language: "ja", isAuto: true, isTranslated: false },
      { id: "manual", language: "ja", isAuto: false, isTranslated: false },
      { id: "translated", language: "en", isAuto: false, isTranslated: true },
    ] as any).map((x) => x.id),
  ).toEqual(["manual", "auto", "translated"]));
it("does not attach to nonwatch or missing players", () =>
  expect(currentBinding()).toBeNull());
it("waits for player controls before attaching", () => {
  history.replaceState({}, "", "/watch?v=12345678901");
  document.body.innerHTML = '<div id="movie_player"><video></video></div>';
  expect(currentBinding()).toBeNull();
  document
    .querySelector("#movie_player")!
    .insertAdjacentHTML("beforeend", '<div class="ytp-right-controls"></div>');
  expect(currentBinding()?.videoId).toBe("12345678901");
  document.body.innerHTML = "";
  history.replaceState({}, "", "/");
});
it("uses initialized caption URL instead of static baseUrl", async () => {
  const { inspectPage } = await import("../../src/youtube/bridge");
  history.replaceState({}, "", "/watch?v=12345678901");
  document.body.innerHTML = '<div id="movie_player"><video></video></div>';
  const player = document.querySelector("#movie_player") as any;
  player.getAudioTrack = () => ({
    captionTracks: [
      {
        languageCode: "ja",
        baseUrl: "https://www.youtube.com/api/timedtext?static=1",
        url: "https://www.youtube.com/api/timedtext?runtime=1",
      },
    ],
  });
  expect(inspectPage().tracks[0].url).toContain("runtime=1");
  document.body.innerHTML = "";
  history.replaceState({}, "", "/");
});
