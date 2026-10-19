import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { handleMessage } from "../../src/background/index";
const { client, listModels } = vi.hoisted(() => ({
  client: vi.fn(),
  listModels: vi.fn(),
}));
vi.mock("../../src/background/ai-client", () => ({
  createAiClient: client,
}));
const provider = {
  schemaVersion: 1,
  baseUrl: "https://draft.test/v1///",
  apiToken: " draft-token ",
  cfClientId: "draft.access",
  cfClientSecret: "draft-secret",
  model: "",
};
beforeEach(() => {
  client.mockReset().mockReturnValue({ listModels });
  listModels.mockReset().mockResolvedValue(["draft-model"]);
  vi.stubGlobal("chrome", {
    runtime: { id: "id" },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(),
        setAccessLevel: vi.fn(async () => {}),
      },
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(),
        remove: vi.fn(async () => {}),
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
it("uses only the options draft for model discovery without reading or saving credentials", async () => {
  const result = await handleMessage(
    { type: "models", provider },
    { id: "id", url: "chrome-extension://id/options.html" },
  );
  expect(result).toEqual(["draft-model"]);
  expect(client).toHaveBeenCalledWith({
    ...provider,
    baseUrl: "https://draft.test/v1",
    apiToken: "draft-token",
  });
  expect(chrome.storage.local.get).not.toHaveBeenCalled();
  expect(chrome.storage.local.set).not.toHaveBeenCalled();
});
it("rejects model discovery from YouTube even with a valid draft", async () => {
  await expect(
    handleMessage({ type: "models", provider }, {
      id: "id",
      url: "https://www.youtube.com/watch?v=12345678901",
      frameId: 0,
      tab: { id: 1 },
    } as chrome.runtime.MessageSender),
  ).rejects.toThrow("僅限設定頁");
  expect(client).not.toHaveBeenCalled();
});
