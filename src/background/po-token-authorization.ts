import { authorizeSender } from "./authorization";
export function authorizePoTokenRequest(
  videoId: string,
  sender: chrome.runtime.MessageSender,
  extensionId: string,
) {
  const options = authorizeSender("po-token-get", sender, extensionId);
  if (options || new URL(sender.url!).searchParams.get("v") !== videoId)
    throw Error("Token 只接受目前影片的操作");
  return sender.tab!.id!;
}
