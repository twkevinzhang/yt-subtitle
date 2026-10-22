import React from "react";
import { render, waitFor, cleanup } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { Onboarding } from "../../src/ui/Onboarding";
import { request } from "../../src/shared/messages";
vi.mock("../../src/shared/messages", () => ({ request: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("starts discovery while panel has never been opened", async () => {
  vi.mocked(request).mockImplementation(async (message) =>
    message.type === "settings-public"
      ? {
          configured: true,
          settingsRevision: 1,
          preferences: { autoSearchApproved: true },
        }
      : null,
  );
  render(
    <Onboarding
      button={document.createElement("button")}
      binding={{
        video: document.createElement("video"),
        container: document.body,
        videoId: "abcdefghijk",
        isAd: () => false,
      }}
      overlay={{} as never}
    />,
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith({ type: "subtitle-ensure" }),
  );
  expect(
    vi
      .mocked(request)
      .mock.calls.filter(([message]) => message.type === "subtitle-ensure"),
  ).toHaveLength(1);
});
it("sends no discovery request without prior automatic-search consent", async () => {
  vi.mocked(request).mockResolvedValue({
    configured: true,
    settingsRevision: 1,
    preferences: { autoSearchApproved: false },
  });
  render(
    <Onboarding
      button={document.createElement("button")}
      binding={{
        video: document.createElement("video"),
        container: document.body,
        videoId: "abcdefghijk",
        isAd: () => false,
      }}
      overlay={{} as never}
    />,
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith({ type: "settings-public" }),
  );
  expect(
    vi
      .mocked(request)
      .mock.calls.some(([message]) => message.type === "subtitle-ensure"),
  ).toBe(false);
});
