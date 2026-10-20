import { createAiClient } from "./ai-client";
import type { SettingsRecord } from "./settings";
import { searchMessages, parseSearchReply } from "../lyrics/search";
import {
  commentMessages,
  parseCommentReply,
  validateCommentBatch,
  type CommentBatch,
} from "../youtube/comments";
import type {
  ChatMessage,
  LyricSearchResult,
  SearchEvidence,
  VideoContext,
} from "../shared/types";
export type SearchRoute = "configured" | "comments" | "web";
export interface SearchGroupSnapshot {
  id: string;
  videoId: string;
  routes: Record<
    SearchRoute,
    LyricSearchResult & {
      phase: "pending" | "complete" | "failed" | "cancelled" | "unconfigured";
      commentsRead?: { count: number; pinned: number };
    }
  >;
}
export async function startSearchGroup(
  video: VideoContext,
  settings: SettingsRecord,
  signal: AbortSignal,
  onUpdate: (snapshot: SearchGroupSnapshot) => void,
  send?: (
    route: SearchRoute,
    messages: ChatMessage[],
    signal: AbortSignal,
  ) => Promise<{ text: string; evidence?: SearchEvidence }>,
  readComments?: (signal: AbortSignal) => Promise<CommentBatch>,
): Promise<SearchGroupSnapshot> {
  const snapshot: SearchGroupSnapshot = {
    id: crypto.randomUUID(),
    videoId: video.videoId,
    routes: {
      configured: { phase: "pending", text: "", candidates: [] },
      comments: { phase: "pending", text: "", candidates: [] },
      web: { phase: "pending", text: "", candidates: [] },
    },
  };
  const controller = new AbortController(),
    abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(abort, 120000),
    publish = () => onUpdate(structuredClone(snapshot));
  publish();
  try {
    await Promise.all(
      (["configured", "comments", "web"] as const).map(async (route) => {
        if (
          route === "configured" &&
          !settings.sources.some((s) => s.enabled)
        ) {
          snapshot.routes[route] = {
            phase: "unconfigured",
            text: "",
            candidates: [],
            error: "尚未設定歌詞來源",
          };
          publish();
          return;
        }
        let rejectAbort: () => void = () => {};
        try {
          if (controller.signal.aborted) throw new Error("已取消");
          const aborted = new Promise<never>((_, reject) => {
            rejectAbort = () =>
              reject(
                new Error(signal.aborted ? "已取消" : "搜尋達 120 秒上限"),
              );
            controller.signal.addEventListener("abort", rejectAbort, {
              once: true,
            });
            if (controller.signal.aborted) rejectAbort();
          });
          let batch: CommentBatch | undefined;
          if (route === "comments") {
            if (!readComments)
              throw new Error("留言讀取器不可用，未要求AI猜測留言內容");
            batch = validateCommentBatch(
              await Promise.race([readComments(controller.signal), aborted]),
              video.videoId,
            );
            snapshot.routes.comments.commentsRead = {
              count: batch.comments.length,
              pinned: batch.comments.filter((c) => c.pinned).length,
            };
            publish();
          }
          if (controller.signal.aborted) throw new Error("已取消");
          const messages = batch
            ? commentMessages(video, batch)
            : searchMessages(video, settings.sources, route);
          const response = await Promise.race([
            send
              ? send(route, messages, controller.signal)
              : batch
                ? createAiClient(settings.provider!)
                    .completeText(messages, controller.signal)
                    .then((text) => ({ text, evidence: undefined }))
                : createAiClient(settings.provider!).searchText(
                    messages,
                    controller.signal,
                  ),
            aborted,
          ]);
          if (controller.signal.aborted) return;
          const result = batch
            ? parseCommentReply(response.text, batch)
            : parseSearchReply(
                response.text,
                settings.sources,
                response.evidence,
                route,
              );
          if (route === "comments")
            result.candidates = result.candidates.filter(
              (c) => new URL(c.url).searchParams.get("v") === video.videoId,
            );
          snapshot.routes[route] = {
            ...result,
            phase: "complete",
            ...(batch
              ? {
                  commentsRead: {
                    count: batch.comments.length,
                    pinned: batch.comments.filter((c) => c.pinned).length,
                  },
                }
              : {}),
          };
        } catch (e) {
          snapshot.routes[route] = {
            text: "",
            candidates: [],
            phase: signal.aborted ? "cancelled" : "failed",
            error: e instanceof Error ? e.message : String(e),
          };
        } finally {
          controller.signal.removeEventListener("abort", rejectAbort);
          publish();
        }
      }),
    );
    return snapshot;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
