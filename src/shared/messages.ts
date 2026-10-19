import type { ExtensionMessage } from "./schemas";
export async function request<T = unknown>(
  message: ExtensionMessage,
): Promise<T> {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok)
    throw new Error(response?.error || "擴充功能未回應，請重新整理頁面");
  return response.data as T;
}
