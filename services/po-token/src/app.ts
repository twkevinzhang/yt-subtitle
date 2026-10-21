export type TokenResult = { poToken: string; expiresAt: string };
export type Generate = (
  videoId: string,
  signal: AbortSignal,
) => Promise<TokenResult>;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
const error = (status: number, code: string) =>
  json({ error: { code, message: code } }, status);

export function createApp(options: {
  generate: Generate;
  authorize: (request: Request) => boolean | Promise<boolean>;
  deadlineMs?: number;
  maxGenerationsPerMinute?: number;
}) {
  let busy = false;
  let generations: number[] = [];
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path === "/healthz" && request.method === "GET")
      return json({ ok: true });
    if (path !== "/v1/po-token") return error(404, "not_found");
    if (request.method !== "POST") return error(405, "method_not_allowed");
    if (!(await options.authorize(request))) return error(401, "unauthorized");
    if (
      request.headers.get("content-type")?.split(";")[0] !== "application/json"
    )
      return error(415, "json_required");
    if (Number(request.headers.get("content-length") || 0) > 4096)
      return error(413, "body_too_large");
    let data: unknown;
    try {
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 4096) {
            await reader.cancel();
            return error(413, "body_too_large");
          }
          chunks.push(value);
        }
      }
      data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return error(400, "invalid_request");
    }
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      Object.keys(data).length !== 1 ||
      !("videoId" in data) ||
      typeof data.videoId !== "string" ||
      !/^[A-Za-z0-9_-]{11}$/.test(data.videoId)
    )
      return error(400, "invalid_request");
    if (busy) return error(429, "busy");
    if (request.signal.aborted) return error(499, "cancelled");
    const now = Date.now();
    generations = generations.filter((time) => time > now - 60_000);
    if (generations.length >= (options.maxGenerationsPerMinute ?? 6))
      return error(429, "generation_limit");
    generations.push(now);
    busy = true;
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    request.signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.deadlineMs ?? 20_000);
    try {
      const result = await options.generate(data.videoId, controller.signal);
      if (controller.signal.aborted)
        return error(
          timedOut ? 504 : 499,
          timedOut ? "deadline_exceeded" : "cancelled",
        );
      if (
        !result ||
        !/^[A-Za-z0-9_-]+={0,2}$/.test(result.poToken) ||
        result.poToken.length > 4096 ||
        !Number.isFinite(Date.parse(result.expiresAt)) ||
        Date.parse(result.expiresAt) <= Date.now()
      )
        return error(502, "invalid_provider_result");
      return json({
        videoId: data.videoId,
        poToken: result.poToken,
        expiresAt: result.expiresAt,
      });
    } catch {
      return error(
        timedOut ? 504 : controller.signal.aborted ? 499 : 502,
        timedOut
          ? "deadline_exceeded"
          : controller.signal.aborted
            ? "cancelled"
            : "provider_failed",
      );
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", cancel);
      busy = false;
    }
  };
}
