import { it, expect } from "vitest";
import { candidateDraft, provenanceOf } from "../../src/lyrics/draft";
const candidate = {
  schemaVersion: 1 as const,
  id: "x",
  title: "new",
  artist: "a",
  version: "live",
  language: "ja",
  sourceId: "s",
  url: "https://lrclib.net/new",
  fullText: null,
  syncedLyrics: null,
  matchReason: "match",
  evidence: { status: "unverified" as const, citations: [] },
};
it("missing full text produces an empty draft, never previous lyrics", () =>
  expect(candidateDraft(candidate, 10000).lines).toEqual([]));
it("invalid synchronized data fails without adopting previous draft", () =>
  expect(() =>
    candidateDraft({ ...candidate, syncedLyrics: "[00:20.00]late" }, 10000),
  ).toThrow());
it("restores actual saved language, source and generating model", () =>
  expect(
    provenanceOf({
      key: { targetLanguage: "en" },
      source: { kind: "network", url: "https://lrclib.net/old" },
      model: "old-model",
    } as any),
  ).toEqual({
    targetLanguage: "en",
    source: { kind: "network", url: "https://lrclib.net/old" },
    model: "old-model",
  }));
