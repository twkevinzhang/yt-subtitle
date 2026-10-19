import type {
  ProviderSettings,
  ChatMessage,
  CompletionEnvelope,
} from "../shared/types";
export function createAiClient(
  provider: ProviderSettings,
  fetcher: typeof fetch = fetch,
) {
  async function call(
    path: string,
    signal: AbortSignal,
    body?: unknown,
  ): Promise<any> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(abort, 120000);
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
      if (!response.ok) throw new Error(`AI 服務回應 HTTP ${response.status}`);
      if (!response.headers.get("Content-Type")?.includes("application/json"))
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
      try {
        return JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new Error("AI 服務回傳無效 JSON");
      }
    } catch (e) {
      if (controller.signal.aborted) throw new Error("請求已取消或逾時");
      if (e instanceof Error && /^(AI |服務|請求)/.test(e.message)) throw e;
      throw new Error("AI 連線失敗，請檢查網址、權限與憑證");
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
  return {
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
      if (!provider.model.trim())
        throw new Error("請先載入、選擇模型並儲存設定");
      const data = await call("chat/completions", signal, {
        model: provider.model,
        messages,
        stream: false,
      });
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new Error("AI 未提供文字結果");
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
