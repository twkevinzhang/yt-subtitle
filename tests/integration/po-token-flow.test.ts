import { expect, it } from "vitest";
import { authorizePoTokenRequest } from "../../src/background/po-token-authorization";
const sender = {
  id: "own",
  url: "https://www.youtube.com/watch?v=e1ZMmRlsaaU",
  frameId: 0,
  tab: { id: 1 },
} as chrome.runtime.MessageSender;
it("authorizes only a current top-frame video request from this extension", () => {
  expect(authorizePoTokenRequest("e1ZMmRlsaaU", sender, "own")).toBe(1);
  for (const s of [
    { ...sender, frameId: 1 },
    { ...sender, id: "other" },
    { ...sender, url: "https://evil.test/watch?v=e1ZMmRlsaaU" },
    { ...sender, url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" },
  ])
    expect(() => authorizePoTokenRequest("e1ZMmRlsaaU", s, "own")).toThrow();
});
