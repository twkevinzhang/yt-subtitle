import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleMessage } from "../../src/background/index";
import { defaults } from "../../src/background/settings";
import { hashInput } from "../../src/background/results";
import type { RunState } from "../../src/shared/types";
const { testSearch } = vi.hoisted(() => ({ testSearch: vi.fn() }));
vi.mock("../../src/background/ai-client", () => ({
  createAiClient: () => ({ testSearch }),
}));
const body = {
  model: "edited-model",
  input: "edited search",
  stream: false,
  store: false,
};
const sender = { id: "id", url: "chrome-extension://id/options.html" };
beforeEach(() => {
  testSearch
    .mockReset()
    .mockResolvedValue({
      status: 400,
      body: { error: { message: "Bad model" } },
    });
  vi.stubGlobal("chrome", {
    runtime: { id: "id" },
    storage: {
      local: {
        get: vi.fn(async () => ({
          settings: {
            ...defaults,
            provider: {
              schemaVersion: 1,
              baseUrl: "https://ai.test/v1",
              apiToken: "test-only-token",
              model: "saved-model",
            },
            revision: 1,
          },
        })),
        setAccessLevel: vi.fn(async () => {}),
      },
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
async function message() {
  return {
    type: "search-test",
    body,
    consent: {
      purpose: "search-test",
      settingsRevision: 1,
      confirmedAt: Date.now(),
      inputHash: await hashInput({ purpose: "search-test", body }),
    },
  };
}
it("uses the edited body and retains the complete HTTP error response in the run", async () => {
  const state = (await handleMessage(await message(), sender)) as RunState;
  await vi.waitFor(() =>
    expect(testSearch).toHaveBeenCalledWith(body, expect.any(AbortSignal)),
  );
  await vi.waitFor(async () => {
    const run = await handleMessage(
      { type: "run", runId: state.runId },
      sender,
    );
    expect(run).toMatchObject({
      state: { phase: "complete" },
      output: { status: 400, body: { error: { message: "Bad model" } } },
    });
  });
});
it("rejects edits made after consent and requests from a YouTube page", async () => {
  const m = await message();
  await expect(
    handleMessage({ ...m, body: { ...body, input: "changed" } }, sender),
  ).rejects.toThrow("重新確認");
  await expect(
    handleMessage(m, {
      id: "id",
      url: "https://www.youtube.com/watch?v=12345678901",
      frameId: 0,
      tab: { id: 1 },
    } as chrome.runtime.MessageSender),
  ).rejects.toThrow("僅限設定頁");
  expect(testSearch).not.toHaveBeenCalled();
});
it("rejects streaming diagnostics before any request", async () => {
  await expect(
    handleMessage(
      { ...(await message()), body: { ...body, stream: true } },
      sender,
    ),
  ).rejects.toThrow();
  expect(testSearch).not.toHaveBeenCalled();
});
