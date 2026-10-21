import fs from "node:fs";
import { gcloud, inventory } from "./gcloud.mjs";
import { inspectInventory, assertApproval, renderService } from "./safety.mjs";
const [configFile, approvalFile] = process.argv.slice(2);
if (!configFile || !approvalFile)
  throw Error("usage: deploy.mjs config.json approval.json");
const c = JSON.parse(fs.readFileSync(configFile, "utf8")),
  a = JSON.parse(fs.readFileSync(approvalFile, "utf8"));
assertApproval(a, { ...c, cpu: 1, memoryMiB: 512, maxInstances: 1 });
const data = inventory(c.project, c.region, c.account);
const report = inspectInventory(data.services, data.revisions);
const file = "artifacts/cloud-run/po-token/preflight/deployment.json";
fs.writeFileSync(
  file,
  JSON.stringify(
    { at: new Date().toISOString(), config: c, approval: a, inventory: report },
    null,
    2,
  ),
);
const manifest = "artifacts/cloud-run/po-token/preflight/service.json";
fs.writeFileSync(manifest, JSON.stringify(renderService(c), null, 2));
assertApproval(a, { ...c, cpu: 1, memoryMiB: 512, maxInstances: 1 });
gcloud(
  [
    "run",
    "services",
    "replace",
    manifest,
    `--project=${c.project}`,
    `--region=${c.region}`,
    `--account=${c.account}`,
    "--quiet",
    "--format=json",
  ],
  { timeout: 180000 },
);
console.log("Service replaced. Run verify before making requests.");
