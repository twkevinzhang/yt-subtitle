import { expect, it } from "vitest";
import { isUserAction } from "../../src/ui/user-action";
it("rejects synthetic clicks for paid actions", () => {
  expect(isUserAction({ nativeEvent: { isTrusted: false } })).toBe(false);
  expect(isUserAction({ nativeEvent: { isTrusted: true } })).toBe(true);
});
