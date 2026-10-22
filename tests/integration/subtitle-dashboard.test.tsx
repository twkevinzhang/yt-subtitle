import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { ProgressSteps } from "../../src/ui/ProgressSteps";
import { initialJob } from "../../src/subtitle/job-state";
afterEach(cleanup);
it("shows model preparation with keyboard accessible tooltip and Escape dismissal", () => {
  const job = {
    ...initialJob({
      tabId: 1,
      videoId: "abcdefghijk",
      sourceFingerprint: "s",
      generation: 1,
    }),
    phase: "preparing-model" as const,
  };
  render(<ProgressSteps job={job} />);
  const step = screen.getByRole("button", { name: "準備語音模型：處理中" });
  fireEvent.focus(step);
  expect(screen.getByRole("tooltip").textContent).toContain("準備語音模型");
  fireEvent.keyDown(step, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
});
