export function authorizeSender(
  type: string,
  sender: chrome.runtime.MessageSender,
  extensionId: string,
) {
  if (sender.id !== extensionId) throw new Error("未授權的擴充功能訊息");
  const options =
    sender.url === `chrome-extension://${extensionId}/options.html` &&
    !sender.tab;
  // Options can be opened in a tab, too; exact extension URL remains the trust boundary.
  const ownOptions =
    options || sender.url === `chrome-extension://${extensionId}/options.html`;
  if (
    ownOptions &&
    (type.startsWith("audio-") ||
      type.startsWith("local-model") ||
      type === "acoustic-position")
  )
    throw new Error("音訊操作僅限 YouTube 主頁面");
  const privileged = [
    "settings-edit",
    "settings-save",
    "preferences-save",
    "clear-credentials",
    "models",
    "search-test",
    "results-clear",
    "results-delete",
  ];
  if (privileged.includes(type) && !ownOptions)
    throw new Error("此操作僅限設定頁");
  if (!ownOptions) {
    const u = new URL(sender.url || "about:blank");
    if (
      u.origin !== "https://www.youtube.com" ||
      u.pathname !== "/watch" ||
      sender.frameId !== 0 ||
      !sender.tab?.id
    )
      throw new Error("只接受目前 YouTube 頁面的操作");
  }
  return ownOptions;
}
