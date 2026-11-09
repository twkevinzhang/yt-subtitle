import { it, expect } from "vitest";
import { authorizeSender } from "../../src/background/authorization";
import { validateMessage } from "../../src/shared/schemas";

const id = "abcdefghijklmnopabcdefghijklmnop";
const options = { id, url: `chrome-extension://${id}/options.html` };
const page = {
  id,
  url: "https://www.youtube.com/watch?v=abcdefghijk",
  frameId: 0,
  tab: { id: 3 },
};
it.each(["cache-list", "cache-delete", "cache-clear"])(
  "%s is only for the settings page",
  (type) => {
    expect(authorizeSender(type, options as never, id)).toBe(true);
    expect(() => authorizeSender(type, page as never, id)).toThrow(
      "僅限設定頁",
    );
  },
);
it("validates cache messages", () => {
  expect(validateMessage({ type: "cache-list" })).toEqual({
    type: "cache-list",
  });
  expect(
    validateMessage({ type: "cache-delete", videoId: "abcdefghijk" }),
  ).toBeTruthy();
  expect(() =>
    validateMessage({ type: "cache-delete", videoId: "short" }),
  ).toThrow();
  expect(() => validateMessage({ type: "cache-delete" })).toThrow();
});
it("lets the video page ask to clear this song's local data when it resets", () => {
  expect(
    validateMessage({ type: "subtitle-reset", clearLocalData: true }),
  ).toEqual({ type: "subtitle-reset", clearLocalData: true });
  expect(validateMessage({ type: "subtitle-reset" })).toEqual({
    type: "subtitle-reset",
  });
  expect(authorizeSender("subtitle-reset", page as never, id)).toBe(false);
});
