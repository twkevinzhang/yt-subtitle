import { parentPort } from "node:worker_threads";
parentPort.postMessage({
  ok: true,
  result: {
    poToken: "dGVzdA",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  },
});
