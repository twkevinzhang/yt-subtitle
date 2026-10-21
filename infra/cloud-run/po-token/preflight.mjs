import fs from "node:fs";
import { inventory } from "./gcloud.mjs";
import { inspectInventory } from "./safety.mjs";
const [project, region, account] = process.argv.slice(2);
if (!project || !region || !account)
  throw Error("usage: preflight.mjs project region account");
const data = inventory(project, region, account);
const report = {
  at: new Date().toISOString(),
  project,
  region,
  account,
  ...inspectInventory(data.services, data.revisions),
};
fs.mkdirSync("artifacts/cloud-run/po-token/preflight", { recursive: true });
fs.writeFileSync(
  "artifacts/cloud-run/po-token/preflight/inventory.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    services: report.services.length,
    revisions: report.revisions.length,
    retainedInstances: report.retainedInstances,
  }),
);
