import React from "react";
import { it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TranslateDialog } from "../../src/ui/TranslateDialog";

beforeAll(() => {
  // jsdom has no modal dialog support.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);
const setup = (busy = false) => {
  const onChoose = vi.fn(),
    onCancel = vi.fn();
  render(
    <TranslateDialog
      own="zh-Hant"
      initial="zh-Hant"
      busy={busy}
      onCancel={onCancel}
      onChoose={onChoose}
    />,
    { container: document.body.appendChild(document.createElement("div")) },
  );
  return { onChoose, onCancel };
};
const button = (name: string) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;

it("offers the user's language first, preselected, among ten", () => {
  setup();
  const options = [...document.querySelectorAll("option")];
  expect(options).toHaveLength(10);
  expect(options[0]!.textContent).toBe("繁體中文（你的語言）");
  expect((document.querySelector("select") as HTMLSelectElement).value).toBe(
    "zh-Hant",
  );
});
it("translates into the chosen language without saving by default", () => {
  const { onChoose } = setup();
  fireEvent.change(document.querySelector("select")!, {
    target: { value: "ja" },
  });
  fireEvent.click(button("請翻譯"));
  expect(onChoose).toHaveBeenCalledWith({ translate: "ja", save: undefined });
});
it("saves 'always' with the chosen language when ticked", () => {
  const { onChoose } = setup();
  fireEvent.change(document.querySelector("select")!, {
    target: { value: "ko" },
  });
  fireEvent.click(screen.getByLabelText("永遠翻譯為 한국어"));
  fireEvent.click(button("請翻譯"));
  expect(onChoose).toHaveBeenCalledWith({
    translate: "ko",
    save: { ask: "always", language: "ko" },
  });
});
it("'never' excludes 'always' and disables translating", () => {
  const { onChoose } = setup();
  fireEvent.click(screen.getByLabelText(/永遠翻譯為/));
  fireEvent.click(screen.getByLabelText("永遠不翻譯任何語言"));
  expect(
    (screen.getByLabelText(/永遠翻譯為/) as HTMLInputElement).checked,
  ).toBe(false);
  expect(button("請翻譯").disabled).toBe(true);
  fireEvent.click(button("這次不用"));
  expect(onChoose).toHaveBeenCalledWith({ save: { ask: "never" } });
});
it("skips this once without saving anything", () => {
  const { onChoose } = setup();
  fireEvent.click(button("這次不用"));
  expect(onChoose).toHaveBeenCalledWith({ save: undefined });
});
it("closes on Escape without choosing, but not while busy", () => {
  const first = setup();
  fireEvent(
    document.querySelector("dialog")!,
    new Event("cancel", { cancelable: true }),
  );
  expect(first.onCancel).toHaveBeenCalledOnce();
  cleanup();
  const busy = setup(true);
  fireEvent(
    document.querySelector("dialog")!,
    new Event("cancel", { cancelable: true }),
  );
  expect(busy.onCancel).not.toHaveBeenCalled();
});
