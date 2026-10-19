import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Onboarding } from "../../src/ui/Onboarding";
import { followYouTubeTheme } from "../../src/content/theme";
const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock("../../src/shared/messages", () => ({ request: requestMock }));
vi.mock("../../src/ui/Panel", () => ({
  Panel: ({ onClose }: any) => (
    <section className="panel">
      字幕工作面板<button onClick={onClose}>關閉</button>
    </section>
  ),
}));
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dark");
});
it("uses a full-size loading shell when opened before settings arrive", async () => {
  requestMock.mockReturnValue(new Promise(() => {}));
  const button = document.createElement("button");
  const { container } = render(
    <Onboarding button={button} binding={{} as any} overlay={{} as any} />,
  );
  fireEvent.click(button);
  expect(
    screen.getByRole("status", { name: "正在載入 AI 歌詞面板" }),
  ).toBeTruthy();
  expect(container.querySelector(".panel .workspace")).toBeTruthy();
  expect(container.querySelectorAll(".skeleton-column")).toHaveLength(2);
});
it("auto opens the same local workspace before and after configuration even when offline", async () => {
  let configured = false;
  requestMock.mockImplementation(async (m: any) => {
    if (m.type === "settings-public")
      return { configured, settingsRevision: configured ? 1 : 0 };
    if (m.type === "connection-check") throw new Error("offline");
  });
  const button = document.createElement("button");
  render(
    <Onboarding
      button={button}
      binding={{} as any}
      overlay={{ stop: vi.fn() } as any}
    />,
  );
  await screen.findByText("字幕工作面板");
  fireEvent.click(screen.getByRole("button", { name: "關閉" }));
  expect(
    screen.getByText("字幕工作面板").closest(".panel")?.parentElement?.style
      .display,
  ).toBe("none");
  fireEvent.click(button);
  configured = true;
  fireEvent.focus(window);
  await screen.findByText("字幕工作面板");
  await waitFor(() =>
    expect(requestMock).toHaveBeenCalledWith({ type: "connection-check" }),
  );
});
it("does not auto open workspace for configured users, but checks once", async () => {
  requestMock.mockClear();
  requestMock.mockResolvedValue({ configured: true, settingsRevision: 1 });
  const button = document.createElement("button");
  render(
    <Onboarding
      button={button}
      binding={{} as any}
      overlay={{ stop: vi.fn() } as any}
    />,
  );
  await waitFor(() =>
    expect(requestMock).toHaveBeenCalledWith({ type: "connection-check" }),
  );
  expect(screen.queryByText("字幕工作面板")).toBeNull();
  fireEvent.click(button);
  await screen.findByText("字幕工作面板");
  fireEvent.focus(window);
  await waitFor(() =>
    expect(
      requestMock.mock.calls.filter(([m]) => m.type === "connection-check"),
    ).toHaveLength(1),
  );
});
it("follows YouTube dark attribute changes and disconnects on cleanup", async () => {
  const host = document.createElement("div");
  const stop = followYouTubeTheme(host);
  expect(host.dataset.theme).toBe("light");
  document.documentElement.setAttribute("dark", "");
  await waitFor(() => expect(host.dataset.theme).toBe("dark"));
  stop();
  document.documentElement.removeAttribute("dark");
  await Promise.resolve();
  expect(host.dataset.theme).toBe("dark");
});
it("does not stop local captions when credentials are cleared", async () => {
  requestMock.mockClear();
  let configured = true;
  requestMock.mockImplementation(async () => ({
    configured,
    settingsRevision: 1,
  }));
  const stop = vi.fn();
  render(
    <Onboarding
      button={document.createElement("button")}
      binding={{} as any}
      overlay={{ stop } as any}
    />,
  );
  await waitFor(() =>
    expect(requestMock).toHaveBeenCalledWith({ type: "connection-check" }),
  );
  configured = false;
  fireEvent.focus(window);
  await waitFor(() =>
    expect(
      requestMock.mock.calls.filter(([m]) => m.type === "settings-public"),
    ).toHaveLength(2),
  );
  expect(stop).not.toHaveBeenCalled();
});
