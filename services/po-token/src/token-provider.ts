import { Worker } from "node:worker_threads";
import type { TokenResult } from "./app.js";

export function createTokenProvider(options: { workerUrl?: URL } = {}) {
  let active = 0;
  return {
    activeWorkers: () => active,
    async generate(videoId: string, signal: AbortSignal): Promise<TokenResult> {
      if (signal.aborted) throw new Error("cancelled");
      const worker = new Worker(
        options.workerUrl ?? new URL("./token-worker.js", import.meta.url),
        { workerData: { videoId }, execArgv: [] },
      );
      active++;
      let cancel!: () => void;
      try {
        return await new Promise<TokenResult>((resolve, reject) => {
          cancel = () => reject(new Error("cancelled"));
          signal.addEventListener("abort", cancel, { once: true });
          if (signal.aborted) {
            cancel();
            return;
          }
          worker.once("message", (message) =>
            message?.ok
              ? resolve(message.result)
              : reject(new Error("provider_failed")),
          );
          worker.once("error", () => reject(new Error("provider_failed")));
          worker.once("exit", () => reject(new Error("provider_exited")));
        });
      } finally {
        signal.removeEventListener("abort", cancel);
        await worker.terminate();
        active--;
      }
    },
  };
}
