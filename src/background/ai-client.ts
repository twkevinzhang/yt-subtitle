import type {
  ProviderSettings,
  ChatMessage,
  CompletionEnvelope,
  SearchTestResult,
  SearchHttpResult,
} from "../shared/types";
export function createAiClient(
  provider: ProviderSettings,
  fetcher: typeof fetch = fetch,
) {
  async function call(
    path: string,
    signal: AbortSignal,
    body?: unknown,
    diagnostic = false,
  ): Promise<any> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(abort, 120000);
    let responseStatus: number | null = null;
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${provider.apiToken}`,
        "Content-Type": "application/json",
      };
      if (provider.cfClientId && provider.cfClientSecret) {
        headers["CF-Access-Client-Id"] = provider.cfClientId;
        headers["CF-Access-Client-Secret"] = provider.cfClientSecret;
      }
      const response = await fetcher(`${provider.baseUrl}/${path}`, {
        method: body ? "POST" : "GET",
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      });
      responseStatus = response.status;
      if (!diagnostic && !response.ok)
        throw new Error(`AI 服務回應 HTTP ${response.status}`);
      if (
        !diagnostic &&
        !response.headers.get("Content-Type")?.includes("application/json")
      )
        throw new Error("服務未回傳 JSON，請檢查 Cloudflare 驗證");
      const reader = response.body?.getReader();
      let length = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 4 * 1024 * 1024) {
            await reader.cancel();
            throw new Error("AI 回應超過 4 MiB");
          }
          chunks.push(value);
        }
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      const raw = new TextDecoder().decode(bytes);
      if (diagnostic) {
        let body: unknown = raw;
        try {
          body = JSON.parse(raw);
        } catch {
          /* Preserve non-JSON HTTP responses as text. */
        }
        return { status: response.status, body } satisfies SearchHttpResult;
      }
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error("AI 服務回傳無效 JSON");
      }
    } catch (e) {
      const message = controller.signal.aborted
        ? "請求已取消或逾時"
        : e instanceof Error && /^(AI |服務|請求)/.test(e.message)
          ? e.message
          : "AI 連線失敗，請檢查網址、權限與憑證";
      if (diagnostic)
        return {
          status: responseStatus,
          body: null,
          error: message,
        } satisfies SearchHttpResult;
      throw new Error(message);
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
  async function completeText(
    messages: ChatMessage[],
    signal: AbortSignal,
  ): Promise<string> {
    if (!provider.model.trim()) throw new Error("請先載入、選擇模型並儲存設定");
    const data = await call("chat/completions", signal, {
      model: provider.model,
      messages,
      stream: false,
    });
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim())
      throw new Error("AI 未提供文字結果");
    return text;
  }
  return {
    completeText,
    async testSearch(
      body: Record<string, unknown>,
      signal: AbortSignal,
    ): Promise<SearchHttpResult> {
      try {
        return await call("responses", signal, body, true);
      } catch (error) {
        return {
          status: null,
          body: null,
          error: error instanceof Error ? error.message : "AI 連線失敗",
        };
      }
    },
    async searchText(
      messages: ChatMessage[],
      signal: AbortSignal,
    ): Promise<SearchTestResult> {
      if (!provider.model.trim())
        throw new Error("請先載入、選擇模型並儲存設定");
      const data = await call("responses", signal, {
        model: provider.model,
        input: messages,
        tools: [{ type: "web_search" }],
        tool_choice: { type: "web_search" },
        include: ["web_search_call.action.sources"],
        stream: false,
        store: false,
      });
      const output = Array.isArray(data.output) ? data.output : [];
      const calls = output.filter(
        (item: any) =>
          item.type === "web_search_call" && item.status === "completed",
      );
      const parts = output
        .filter((item: any) => item.type === "message" && item.role !== "user")
        .flatMap((item: any) =>
          Array.isArray(item.content) ? item.content : [],
        );
      const text = parts
        .filter(
          (part: any) =>
            part.type === "output_text" && typeof part.text === "string",
        )
        .map((part: any) => part.text)
        .join("\n");
      if (!text.trim()) throw new Error("AI 未提供文字結果");
      const urls = [
        ...calls.flatMap((item: any) =>
          Array.isArray(item.action?.sources)
            ? item.action.sources.map((source: any) => source.url)
            : [],
        ),
        ...parts.flatMap((part: any) =>
          Array.isArray(part.annotations)
            ? part.annotations
                .filter((a: any) => a.type === "url_citation")
                .map((a: any) => a.url)
            : [],
        ),
      ].filter((value: unknown): value is string => {
        if (typeof value !== "string") return false;
        try {
          const url = new URL(value);
          return url.protocol === "https:" && !url.username && !url.password;
        } catch {
          return false;
        }
      });
      return {
        text,
        evidence: {
          status: calls.length ? "verified" : "unverified",
          citations: [...new Set<string>(urls)],
          ...(calls.length
            ? { toolEvidence: "web_search_call:completed" }
            : {}),
        },
      };
    },
    async listModels(signal: AbortSignal): Promise<string[]> {
      const data = await call("models", signal);
      if (!Array.isArray(data.data)) throw new Error("AI 模型清單格式錯誤");
      return data.data
        .map((x: any) => x.id)
        .filter((x: any) => typeof x === "string");
    },
    async completeJson(
      messages: ChatMessage[],
      signal: AbortSignal,
    ): Promise<CompletionEnvelope> {
      const text = await completeText(messages, signal);
      try {
        return {
          payload: JSON.parse(
            text.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""),
          ),
          evidence: { status: "unverified", citations: [] },
        };
      } catch {
        throw new Error("AI 結果不是有效 JSON，請確認模型支援結構化回覆");
      }
    },
  };
}
