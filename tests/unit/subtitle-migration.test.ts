import { it, expect } from "vitest";
import { preferencesSchema } from "../../src/shared/schemas";
it("drops legacy alignment mode without silently authorizing automatic requests", () => {
  const prefs = preferencesSchema.parse({
    alignmentMode: "background",
    mode: "original",
    targetLanguage: "en",
    fontSize: 28,
    position: "bottom",
  });
  expect(prefs).not.toHaveProperty("alignmentMode");
  expect(prefs.autoSearchApproved).toBe(false);
});
