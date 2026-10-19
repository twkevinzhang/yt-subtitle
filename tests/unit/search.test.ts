import { it, expect } from "vitest";
import {
  validateCandidates,
  searchMessages,
  parseSearchReply,
} from "../../src/lyrics/search";
const source = {
  schemaVersion: 1 as const,
  id: "s",
  name: "s",
  domain: "example.com",
  includeSubdomains: false,
  enabled: true,
};
const candidate = {
  id: "a",
  title: "song",
  artist: "artist",
  version: "live",
  language: "ja",
  sourceId: "s",
  url: "https://example.com/lyrics",
  fullText: null,
  syncedLyrics: null,
  matchReason: "matches",
};
const evidence = { status: "unverified" as const, citations: [] };
it("preserves AI refusal text instead of discarding the reason", () => {
  const text = JSON.stringify({
    candidates: [],
    error: "服務目前無法搜尋網路",
  });
  const result = parseSearchReply(text, [source]);
  expect(result.text).toBe(text);
  expect(result.error).toBeTruthy();
  expect(result.candidates).toEqual([]);
});
it("keeps non-JSON replies for display without treating them as lyrics", () => {
  const text = "找不到這個 live 版本，請貼上歌詞。";
  const result = parseSearchReply(text, [source]);
  expect(result.text).toBe(text);
  expect(result.error).toContain("格式");
  expect(result.candidates).toEqual([]);
});
it("retains fenced raw replies while enforcing source and evidence validation", () => {
  const text =
    "```json\n" + JSON.stringify({ candidates: [candidate] }) + "\n```";
  expect(parseSearchReply(text, [source])).toMatchObject({
    text,
    candidates: [{ id: "a", evidence: { status: "unverified" } }],
  });
  const spoof = parseSearchReply(
    JSON.stringify({
      candidates: [{ ...candidate, url: "https://evil.test/lyrics" }],
    }),
    [source],
  );
  expect(spoof.candidates).toEqual([]);
  expect(spoof.error).toContain("來源");
});
it("rejects spoofed domains and disabled sources", () => {
  expect(
    validateCandidates(
      {
        candidates: [
          { ...candidate, url: "https://example.com.evil.test/lyrics" },
        ],
      },
      [source],
      evidence,
    ),
  ).toEqual([]);
  expect(
    validateCandidates(
      { candidates: [candidate] },
      [{ ...source, enabled: false }],
      evidence,
    ),
  ).toEqual([]);
});
it("retains source links with missing full text and ignores model verification", () => {
  const c = validateCandidates(
    { candidates: [{ ...candidate, evidence: { status: "verified" } }] },
    [source],
    evidence,
  );
  expect(c[0].fullText).toBeNull();
  expect(c[0].evidence.status).toBe("unverified");
});
it("requires enabled sources", () =>
  expect(() => searchMessages({ title: "x" } as any, [])).toThrow());
