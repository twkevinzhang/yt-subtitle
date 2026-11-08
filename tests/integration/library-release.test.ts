import { expect, it } from "vitest";
import {
  resolveLibrary,
  resolveAligner,
} from "../../src/subtitle/library-loader";
import { createBinding } from "lyric-align-ts";
import type { LyricAlignBinding } from "../../src/subtitle/library-contract";
it("accepts the installed npm package as the consumer contract", () => {
  const binding: LyricAlignBinding = createBinding();
  expect(binding.capabilities.libraryVersion).toBe("1.0.2");
  expect(binding.capabilities.contractVersion).toBe(1);
});
it("loads the packaged release through its static URL and rejects incompatible contracts", async () => {
  const binding = {
    capabilities: {
      contractVersion: 1,
      libraryVersion: "1.0.2",
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
  expect(requested).toContain("vendor/lyric-align-ts/dist/index.js");
  await expect(
    resolveLibrary(async () => ({
      createBinding: () => ({
        ...binding,
        capabilities: { ...binding.capabilities, contractVersion: 2 },
      }),
    })),
  ).rejects.toMatchObject({ code: "CONTRACT_VIOLATION" });
});
it("loads createAligner from the same pinned release and rejects mismatches", async () => {
  const createAligner = async () => ({});
  const binding = (libraryVersion: string) => ({
    capabilities: { contractVersion: 1, libraryVersion },
  });
  let requested = "";
  expect(
    await resolveAligner(async (url) => {
      requested = url;
      return { createAligner, createBinding: () => binding("1.0.2") };
    }),
  ).toBe(createAligner);
  expect(requested).toContain("vendor/lyric-align-ts/dist/index.js");
  await expect(
    resolveAligner(async () => ({ createBinding: () => binding("1.0.2") })),
  ).rejects.toMatchObject({ code: "CONTRACT_VIOLATION" });
  await expect(
    resolveAligner(async () => ({
      createAligner,
      createBinding: () => binding("9.9.9"),
    })),
  ).rejects.toMatchObject({ code: "CONTRACT_VIOLATION" });
});
