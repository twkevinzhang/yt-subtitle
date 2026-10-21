// Explicit opt-in; never logs identity or PO tokens. No retries.
const endpoint = process.env.PO_TOKEN_SERVICE_URL;
const identity = process.env.PO_TOKEN_IDENTITY_TOKEN;
const videoId = process.argv[2];
if (
  !endpoint ||
  !videoId ||
  !/^https:\/\/[a-z0-9.-]+\.run\.app\/?$/.test(endpoint) ||
  !/^[A-Za-z0-9_-]{11}$/.test(videoId)
)
  throw Error("Explicit Cloud Run HTTPS URL and video ID required");
const started = Date.now();
const r = await fetch(endpoint.replace(/\/$/, "") + "/v1/po-token", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(identity ? { authorization: "Bearer " + identity } : {}),
  },
  body: JSON.stringify({ videoId }),
  signal: AbortSignal.timeout(28000),
  redirect: "error",
});
if (!r.ok) throw Error("Token API returned HTTP " + r.status);
const value = await r.json();
if (
  value.videoId !== videoId ||
  !value.poToken ||
  Date.parse(value.expiresAt) <= Date.now()
)
  throw Error("Invalid API contract");
console.log(
  JSON.stringify({
    ok: true,
    videoId,
    elapsedMs: Date.now() - started,
    tokenBytes: Buffer.from(value.poToken, "base64url").length,
  }),
);
