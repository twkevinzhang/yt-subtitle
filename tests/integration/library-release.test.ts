import { expect, it } from "vitest";
import { resolveLibrary } from "../../src/subtitle/library-loader";
import { createBinding } from "@twkevinzhang/lyric-align-ts";
import type { LyricAlignBinding } from "../../src/subtitle/library-contract";
it("accepts the installed npm package as the consumer contract", () => {
  const binding: LyricAlignBinding = createBinding();
  expect(binding.capabilities.libraryVersion).toBe("0.1.0");
  expect(binding.capabilities.contractVersion).toBe(1);
});
it("loads the packaged release through its static URL and rejects incompatible contracts", async () => {
  const binding = {
    capabilities: {
      contractVersion: 1,
      libraryVersion: "0.1.0",
      supportedLanguages: ["en"],
      lyricsContext: false,
    },
    createSession: async () => ({}),
  };
  let requested = "";
  expect(
    await resolveLibrary(async (url) => {
      requested = url;
      return { createBinding: () => binding };
    }),
  ).toBe(binding);
  expect(requested).toContain("vendor/lyric-align-ts/index.js");
  await expect(
    resolveLibrary(async () => ({
      createBinding: () => ({
        ...binding,
        capabilities: { ...binding.capabilities, contractVersion: 2 },
      }),
    })),
  ).rejects.toMatchObject({ code: "CONTRACT_VIOLATION" });
});
