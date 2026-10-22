import { afterEach, expect, test, vi } from "vitest";
import {
  normalizeWebsite,
  parseSiteMetadata,
  identifyWebsite,
} from "../../src/options/site-metadata";
import { sourceSchema } from "../../src/shared/schemas";
import { searchMessages } from "../../src/lyrics/search";

afterEach(() => vi.unstubAllGlobals());
test.each([
  ["https://www.lrclib.net/docs?q=hello#api", "lrclib.net"],
  [" genius.com/lyrics ", "genius.com"],
  ["https://lyrics.example.org/song", "lyrics.example.org"],
  ["https://音樂.tw/歌詞", "xn--zbwz39g.tw"],
])("extracts the hostname from %s", (input, domain) => {
  expect(normalizeWebsite(input).domain).toBe(domain);
});
test.each([
  "not a website",
  "javascript:alert(1)",
  "https://user:pass@example.org",
  "https://localhost/",
  "https://127.0.0.1",
  "https://example.org:9000",
  "https://-bad.org",
])("rejects unsupported website input %s", (input) => {
  expect(() => normalizeWebsite(input)).toThrow();
});
test("prefers site name metadata, resolves icons and ignores third-party images", () => {
  expect(
    parseSiteMetadata(
      `<title>Lyrics | Home</title><meta property="og:site_name" content="Lyrics &amp; Music"><link rel="apple-touch-icon" href="/logo.png"><link rel="icon" href="https://unrelated.test/track.png">`,
      "https://example.org/",
    ),
  ).toEqual({
    name: "Lyrics & Music",
    icons: ["https://example.org/logo.png", "https://example.org/favicon.ico"],
  });
});
test("uses title then hostname as the name fallback and limits name length", () => {
  expect(
    parseSiteMetadata("<title>  My   lyrics  </title>", "https://example.org/")
      .name,
  ).toBe("My lyrics");
  expect(
    parseSiteMetadata("<script>alert(1)</script>", "https://example.org/").name,
  ).toBe("example.org");
  expect(
    parseSiteMetadata(
      `<title>${"a".repeat(150)}</title>`,
      "https://example.org/",
    ).name,
  ).toHaveLength(100);
});
test("permission denial returns an addable fallback without fetching", async () => {
  vi.stubGlobal("chrome", {
    permissions: { request: vi.fn(async () => false) },
  });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const result = await identifyWebsite("https://example.org/song");
  expect(result).toMatchObject({ domain: "example.org", name: "example.org" });
  expect(result.iconDataUrl).toBeUndefined();
  expect(result.notice).toContain("權限");
  expect(fetcher).not.toHaveBeenCalled();
});
test("failed network requests still provide an addable domain fallback", async () => {
  vi.stubGlobal("chrome", {
    permissions: { request: vi.fn(async () => true) },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    }),
  );
  expect(await identifyWebsite("example.org")).toMatchObject({
    domain: "example.org",
    name: "example.org",
  });
});
test("keeps stored icons through source validation but rejects remote or active content", () => {
  const source = {
    schemaVersion: 1,
    id: "source",
    name: "Music",
    domain: "example.org",
    enabled: true,
    includeSubdomains: false,
    iconDataUrl: "data:image/png;base64,aGVsbG8=",
  };
  expect(sourceSchema.parse(source)).toHaveProperty(
    "iconDataUrl",
    source.iconDataUrl,
  );
  expect(
    sourceSchema.safeParse({
      ...source,
      iconDataUrl: "https://example.org/logo.png",
    }).success,
  ).toBe(false);
  expect(
    sourceSchema.safeParse({
      ...source,
      iconDataUrl: "data:image/svg+xml;base64,aGVsbG8=",
    }).success,
  ).toBe(false);
});
test("website icons are local presentation data and are never sent to the AI service", () => {
  const messages = searchMessages(
    {
      schemaVersion: 1,
      videoId: "abcdefghijk",
      title: "Song",
      channel: "Artist",
      description: "",
      durationMs: 1000,
    },
    [
      {
        schemaVersion: 1,
        id: "lyrics",
        name: "Lyrics",
        domain: "example.org",
        enabled: true,
        includeSubdomains: false,
        iconDataUrl: "data:image/png;base64,aGVsbG8=",
      },
    ],
  );
  const payload = JSON.parse(messages[1].content);
  expect(payload.sources[0]).not.toHaveProperty("iconDataUrl");
  expect(payload.sources[0]).toMatchObject({
    id: "lyrics",
    domain: "example.org",
    name: "Lyrics",
  });
});
