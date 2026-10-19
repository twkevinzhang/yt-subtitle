import { it, expect } from "vitest";
import { authorizeSender } from "../../src/background/authorization";
it("rejects content credentials commands and iframe messages", () => {
  const sender = {
    id: "id",
    url: "https://www.youtube.com/watch?v=12345678901",
    frameId: 0,
    tab: { id: 1 },
  };
  expect(() => authorizeSender("settings-edit", sender as any, "id")).toThrow();
  expect(() =>
    authorizeSender("search", { ...sender, frameId: 1 } as any, "id"),
  ).toThrow();
  expect(() => authorizeSender("search", sender as any, "id")).not.toThrow();
});
it("only trusts exact own options page", () => {
  expect(() =>
    authorizeSender(
      "settings-edit",
      { id: "id", url: "chrome-extension://id/options.html" } as any,
      "id",
    ),
  ).not.toThrow();
  expect(() =>
    authorizeSender(
      "settings-edit",
      { id: "wrong", url: "chrome-extension://id/options.html" } as any,
      "id",
    ),
  ).toThrow();
});
