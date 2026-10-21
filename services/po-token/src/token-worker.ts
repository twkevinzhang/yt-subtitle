import { parentPort, workerData } from "node:worker_threads";
import { mintPoToken } from "../vendor/bgutil/session-manager.js";
try {
  parentPort?.postMessage({
    ok: true,
    result: await mintPoToken(workerData.videoId),
  });
} catch {
  parentPort?.postMessage({ ok: false });
}
