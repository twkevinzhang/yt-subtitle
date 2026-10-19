let creating: Promise<void> | undefined;
export async function ensureAcousticHost() {
  const url = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  if (contexts.length) return;
  if (!creating)
    creating = chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: "在獨立 Worker 執行本機歌詞聲學校時與重用模型",
      })
      .finally(() => {
        creating = undefined;
      });
  await creating;
}
export async function callAcousticHost(
  command: string,
  input: Record<string, unknown> = {},
) {
  await ensureAcousticHost();
  const response = await chrome.runtime.sendMessage({
    target: "acoustic-host",
    command,
    ...input,
  });
  if (!response?.ok) throw new Error(response?.error || "聲學宿主未回應");
  return response.data;
}
export function authorizeAcousticHost(sender: chrome.runtime.MessageSender) {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL("offscreen.html")
  )
    throw new Error("未授權聲學事件來源");
}
