import React, { useState } from "react";
import { request } from "../shared/messages";
import { searchTestBodySchema } from "../shared/schemas";
import { hashInput } from "../background/results";
import { searchMessages } from "../lyrics/search";
import type { SettingsRecord } from "../background/settings";
import type { RunRecord } from "../background/runs";
import type {
  RunState,
  SearchHttpResult,
  SourceSettings,
} from "../shared/types";

function initialBody(model: string, sources: SourceSettings[]) {
  try {
    return JSON.stringify(
      {
        model,
        input: searchMessages(
          {
            schemaVersion: 1,
            videoId: "00000000000",
            title:
              "搜尋測試：查詢 LRCLIB 官方說明並回傳可核對來源；不要編造歌詞",
            channel: "",
            description: "",
            durationMs: 0,
          },
          sources,
        ),
        tools: [{ type: "web_search" }],
        tool_choice: { type: "web_search" },
        include: ["web_search_call.action.sources"],
        stream: false,
        store: false,
      },
      null,
      2,
    );
  } catch {
    return "";
  }
}

export function SearchTest({
  open,
  ready,
  model,
  sources,
  onBusy,
}: {
  open: boolean;
  ready: boolean;
  model: string;
  sources: SourceSettings[];
  onBusy(value: boolean): void;
}) {
  const [body, setBody] = useState(() => initialBody(model, sources));
  const [response, setResponse] = useState<SearchHttpResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const search = async () => {
    setError("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      setError("Request body 不是有效 JSON，請修正後再搜尋。");
      return;
    }
    const validated = searchTestBodySchema.safeParse(parsed);
    if (!validated.success) {
      setError(
        "請確認 Request body 包含 model、input，並設定 stream: false、store: false；內容上限 120000 字元。",
      );
      return;
    }
    if (
      !window.confirm(
        "將送出上方 Request body，使用已儲存服務的憑證並消耗模型額度。繼續？",
      )
    )
      return;
    setResponse(null);
    setSent(true);
    setBusy(true);
    onBusy(true);
    let runId: string | undefined;
    try {
      const s = await request<SettingsRecord>({ type: "settings-edit" });
      const consent = {
        purpose: "search-test" as const,
        inputHash: await hashInput({
          purpose: "search-test",
          body: validated.data,
        }),
        settingsRevision: s.revision,
        confirmedAt: Date.now(),
      };
      const run = await request<RunState>({
        type: "search-test",
        body: validated.data,
        consent,
      });
      runId = run.runId;
      const deadline = Date.now() + 130000;
      while (Date.now() < deadline) {
        const result = await request<RunRecord>({ type: "run", runId });
        if (result.state.phase === "complete") {
          const output = result.output as SearchHttpResult;
          setResponse(output);
          if (output.error) setError(output.error);
          return;
        }
        if (["failed", "cancelled", "interrupted"].includes(result.state.phase))
          throw new Error(result.state.errorCode || "測試中斷");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error("測試逾時");
    } catch (e) {
      setError(e instanceof Error ? e.message : "搜尋失敗");
    } finally {
      if (runId) {
        try {
          await request({ type: "cancel", runId });
        } catch {
          /* Keep the original diagnostic result. */
        }
      }
      setBusy(false);
      onBusy(false);
    }
  };
  return (
    <div
      id="search-test"
      className="search-test"
      role="region"
      aria-label="測試搜尋"
      hidden={!open}
    >
      <label>
        <span>Request body</span>
        <textarea
          spellCheck={false}
          value={body}
          disabled={busy}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <p className="muted">
        送往已儲存服務的 /responses；此操作會使用模型額度。憑證由背景程式加入
        headers。
      </p>
      <div className="search-test-actions">
        <button
          className="primary"
          disabled={busy || !ready}
          onClick={() => void search()}
        >
          {busy ? "搜尋中…" : sent ? "再次搜尋" : "搜尋"}
        </button>
        {response && (
          <span
            role="status"
            className={`http-status http-status-${response.status === null ? "none" : Math.floor(response.status / 100) + "xx"}`}
          >
            Response ·{" "}
            {response.status === null
              ? "未收到 HTTP 回應"
              : `HTTP ${response.status}`}
          </span>
        )}
      </div>
      {busy && <p role="status">正在等待 AI 服務回應…</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {response && (
        <div
          role="region"
          aria-label="完整 API 回應"
          className="search-response"
        >
          <pre tabIndex={0}>
            {typeof response.body === "string"
              ? response.body
              : JSON.stringify(response.body, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
