import { it, expect } from "vitest";
import { backView, type SubtitleView } from "../../src/subtitle/navigation";
it("returns source pages to method choice and processing/results to the original source", () => {
  expect(backView("ai", "ai")).toBe("method");
  expect(backView("paste", "paste")).toBe("method");
  for (const view of ["processing", "result"] as SubtitleView[]) {
    expect(backView(view, "ai")).toBe("ai");
    expect(backView(view, "paste")).toBe("paste");
  }
});
