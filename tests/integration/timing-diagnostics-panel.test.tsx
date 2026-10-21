import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  act,
} from "@testing-library/react";
import { TimingDiagnostics } from "../../src/ui/TimingDiagnostics";
import { createTimingDiagnostics } from "../../src/acoustic/timing-diagnostics";
import { normalizeSubtitle } from "../../src/lyrics/subtitle-source";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function report() {
  const lines = normalizeSubtitle(
    "private original lyric",
    { kind: "paste" },
    4000,
  );
  const d = createTimingDiagnostics(
    { runId: "r", videoId: "12345678901", tabId: 0, draftRevision: 1 },
    lines,
  );
  d.mark([lines[0].id], "ambiguous");
  d.finish("partial");
  return d.snapshot();
}
it("shows unresolved evidence, a fresh-run baseline and explicitly overlapping decode metrics", () => {
  render(<TimingDiagnostics report={report()} />);
  fireEvent.click(screen.getByText("補時診斷"));
  expect(
    screen.getByText(/開始時已有 0 句.*本次新增 0 句.*待處理 1 句/),
  ).toBeTruthy();
  expect(screen.getByText(/解碼.*可能.*重疊/)).toBeTruthy();
  expect(screen.getByText(/第 1 行.*重複段落歧義/)).toBeTruthy();
  expect(screen.queryByText("private original lyric")).toBeNull();
});
it("downloads the JSON report and releases the object URL", async () => {
  let blob: Blob | undefined;
  const createObjectURL = vi.fn((value: Blob) => {
    blob = value;
    return "blob:diagnostic";
  });
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  let filename = "";
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    filename = this.download;
  });
  render(<TimingDiagnostics report={report()} />);
  fireEvent.click(screen.getByText("補時診斷"));
  fireEvent.click(screen.getByRole("button", { name: "下載診斷 JSON" }));
  const json = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob!);
  });
  expect(JSON.parse(json)).toMatchObject({
    runId: "r",
    outcome: "partial",
    pendingCount: 1,
  });
  expect(json).not.toContain("private original lyric");
  expect(filename).toBe("alignment-diagnostics-12345678901-r.json");
  await vi.waitFor(
    () => expect(revokeObjectURL).toHaveBeenCalledWith("blob:diagnostic"),
    { timeout: 2000 },
  );
});
it("updates a running stage while waiting and stops ticking when the report ends", () => {
  vi.useFakeTimers();
  const value = {
    ...report(),
    outcome: "running" as const,
    elapsedMs: 2000,
    active: { stage: "recognize" as const, elapsedMs: 1000 },
  };
  const { rerender } = render(<TimingDiagnostics report={value} />);
  fireEvent.click(screen.getByText("補時診斷"));
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByText(/本次耗時 4.0 秒/)).toBeTruthy();
  expect(screen.getByText(/目前：語音辨識.*3.0 秒/)).toBeTruthy();
  rerender(
    <TimingDiagnostics
      report={{
        ...value,
        elapsedMs: 4000,
        outcome: "cancelled",
        active: undefined,
      }}
    />,
  );
  expect(vi.getTimerCount()).toBe(0);
});
