import React from "react";
import { expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { LyricsPreview } from "../../src/ui/LyricsPreview";
afterEach(cleanup);
it("shows all lines, respects display mode and seeks only timed lyrics", () => {
  const seek = vi.fn();
  const video = document.createElement("video");
  const lines = [
    {
      id: "a",
      original: "第一句",
      translation: "First",
      startMs: 1000,
      endMs: 2000,
      cueIds: [],
      status: "manual" as const,
      excluded: false,
    },
    {
      id: "b",
      original: "待校時",
      cueIds: [],
      status: "unaligned" as const,
      excluded: false,
    },
  ];
  render(
    <LyricsPreview
      lines={lines}
      mode="bilingual"
      offsetMs={100}
      video={video}
      seek={seek}
    />,
  );
  expect(screen.getByText("第一句")).toBeTruthy();
  expect(screen.getByText("First")).toBeTruthy();
  expect(screen.getAllByText("待校時").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: /第一句/ }));
  expect(seek).toHaveBeenCalledWith(1100);
  expect(
    screen.getByRole("button", { name: /待校時/ }).hasAttribute("disabled"),
  ).toBe(true);
  video.currentTime = 1.5;
  fireEvent.timeUpdate(video);
  expect(
    screen.getByRole("button", { name: /第一句/ }).getAttribute("aria-current"),
  ).toBe("true");
});
