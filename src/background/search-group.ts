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
  storageError?: string;
  videoId: string;
  routes: Record<
    SearchRoute,
    LyricSearchResult & {
      phase: "pending" | "complete" | "failed" | "cancelled" | "unconfigured";
      requestBody?: Record<string, unknown>;
      endpoint?: "responses" | "chat/completions";
      rawResponse?: unknown;
      httpStatus?: number | null;
      commentBatch?: CommentBatch;
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
  options?: {
    onlyRoute: SearchRoute;
    body: Record<string, unknown>;
    previous: SearchGroupSnapshot;
  },
  onRouteStart?: (
    route: SearchRoute,
    controller: AbortController,
  ) => () => void,
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
  if (options) Object.assign(snapshot, structuredClone(options.previous));
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
        if (options && options.onlyRoute !== route) return;
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
        snapshot.routes[route] = {
          ...snapshot.routes[route],
          phase: "pending",
          candidates: [],
          error: undefined,
        };
        publish();
        const routeController = new AbortController();
        const abortRoute = () => routeController.abort();
        controller.signal.addEventListener("abort", abortRoute, { once: true });
        if (controller.signal.aborted) abortRoute();
        const release = onRouteStart?.(route, routeController);
        let rejectAbort: () => void = () => {};
        try {
          if (routeController.signal.aborted) throw new Error("已取消");
          const aborted = new Promise<never>((_, reject) => {
            rejectAbort = () =>
              reject(
                new Error(
                  signal.aborted || !controller.signal.aborted
                    ? "已取消"
                    : "搜尋達 120 秒上限",
                ),
              );
            routeController.signal.addEventListener("abort", rejectAbort, {
              once: true,
            });
            if (routeController.signal.aborted) rejectAbort();
          });
          let batch: CommentBatch | undefined;
          if (route === "comments") {
            if (!readComments)
              throw new Error("留言讀取器不可用，未要求AI猜測留言內容");
            batch = validateCommentBatch(
              options?.previous.routes.comments.commentBatch ??
                (await Promise.race([
                  readComments(routeController.signal),
                  aborted,
                ])),
              video.videoId,
            );
            snapshot.routes.comments.commentsRead = {
              count: batch.comments.length,
              pinned: batch.comments.filter((c) => c.pinned).length,
            };
            publish();
          }
          if (routeController.signal.aborted) throw new Error("已取消");
          const messages = batch
            ? commentMessages(video, batch)
            : searchMessages(video, settings.sources, route);
          const client = createAiClient(settings.provider!);
          const endpoint =
            route === "comments"
              ? ("chat/completions" as const)
              : ("responses" as const);
          const requestBody =
            options?.body ?? client.requestBody(messages, route !== "comments");
          Object.assign(snapshot.routes[route], {
            requestBody,
            endpoint,
            text: "",
            rawResponse: undefined,
            httpStatus: undefined,
            ...(batch ? { commentBatch: batch } : {}),
          });
          publish();
          const response = await Promise.race([
            send
              ? send(route, messages, routeController.signal)
              : client.inspectRequest(
                  endpoint,
                  requestBody,
                  routeController.signal,
                ),
            aborted,
          ]);
          if (routeController.signal.aborted) return;
          if ("rawResponse" in response)
            Object.assign(snapshot.routes[route], {
              rawResponse: response.rawResponse,
              httpStatus:
                "httpStatus" in response ? response.httpStatus : undefined,
              text: response.text,
            });
          if ("error" in response && response.error)
            throw new Error(String(response.error));
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
            ...snapshot.routes[route],
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
            ...snapshot.routes[route],
            candidates: [],
            phase:
              signal.aborted ||
              (routeController.signal.aborted && !controller.signal.aborted)
                ? "cancelled"
                : "failed",
            error: e instanceof Error ? e.message : String(e),
          };
        } finally {
          release?.();
          controller.signal.removeEventListener("abort", abortRoute);
          routeController.signal.removeEventListener("abort", rejectAbort);
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
