// Adapted from Brainicism/bgutil-ytdlp-pot-provider (GPL-3.0-only).
// Provenance and retained homepage patch are documented in UPSTREAM.md.
import axios from "axios";
import { JSDOM } from "jsdom";
import { BotGuardClient } from "bgutils-js/botguard";
import { WebPoMinter } from "bgutils-js/webpo";
import {
  parseLooseJSON,
  getHeaders,
  buildURL,
  USER_AGENT,
} from "bgutils-js/utils";

export async function mintPoToken(videoId: string) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>',
    {
      url: "https://www.youtube.com/",
      referrer: "https://www.youtube.com/",
      resources: { userAgent: USER_AGENT },
    },
  );
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    origin: dom.window.origin,
  });
  if (!Reflect.has(globalThis, "navigator"))
    Object.defineProperty(globalThis, "navigator", {
      value: dom.window.navigator,
    });
  const network = axios.create({
    timeout: 12_000,
    proxy: false,
    maxRedirects: 3,
    maxContentLength: 8 * 1024 * 1024,
  });
  let client: BotGuardClient | undefined;
  try {
    const page = await network.get<string>("https://www.youtube.com", {
      headers: {
        accept: "*/*",
        "accept-language": "en-US,en;q=0.7",
        "user-agent": USER_AGENT,
      },
    });
    const configMatch = page.data.match(/ytcfg\.set\(({.+?})\);/s);
    const challengeMatch = page.data.match(
      /window\.ytAtN\(\s*({[\s\S]*?})\s*\)/,
    );
    if (!configMatch || !challengeMatch)
      throw new Error("homepage_challenge_missing");
    const yt = { config_: JSON.parse(configMatch[1]) };
    Object.assign(globalThis, { yt });
    Object.assign(dom.window, { yt });
    const challenge = parseLooseJSON(challengeMatch[1])?.R?.bgChallenge;
    if (!challenge?.program || !challenge.globalName)
      throw new Error("invalid_challenge");
    const interpreter = new URL(
      challenge.interpreterUrl
        .privateDoNotAccessOrElseTrustedResourceUrlWrappedValue,
      "https://www.youtube.com",
    );
    if (
      interpreter.protocol !== "https:" ||
      !["www.google.com", "www.youtube.com"].includes(interpreter.hostname)
    )
      throw new Error("invalid_interpreter_origin");
    const source = await network.get<string>(interpreter.href, {
      responseType: "text",
    });
    new Function(source.data)();
    client = await BotGuardClient.create({
      program: challenge.program,
      globalName: challenge.globalName,
      globalObject: globalThis,
    });
    const webPoSignalOutput: Parameters<typeof WebPoMinter.create>[1] = [];
    const snapshot = await client.snapshot({ webPoSignalOutput });
    const response = await network.post(
      buildURL("GenerateIT"),
      JSON.stringify(["O43z0dpjhgX20SCx4KAo", snapshot]),
      { headers: getHeaders() },
    );
    const [
      integrityToken,
      estimatedTtlSecs,
      mintRefreshThreshold,
      websafeFallbackToken,
    ] = response.data;
    if (
      !integrityToken ||
      !Number.isFinite(estimatedTtlSecs) ||
      estimatedTtlSecs <= 0
    )
      throw new Error("invalid_integrity_token");
    const minter = await WebPoMinter.create(
      {
        integrityToken,
        estimatedTtlSecs,
        mintRefreshThreshold,
        websafeFallbackToken,
      },
      webPoSignalOutput,
    );
    const poToken = await minter.mintAsWebsafeString(videoId);
    return {
      poToken,
      expiresAt: new Date(
        Date.now() + Math.min(estimatedTtlSecs, 6 * 3600) * 1000,
      ).toISOString(),
    };
  } finally {
    await client?.shutdown().catch(() => {});
    dom.window.close();
  }
}
