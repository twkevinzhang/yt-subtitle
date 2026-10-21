import fs from "node:fs";
import { gcloud, inventory } from "./gcloud.mjs";
import { inspectInventory, assertTarget } from "./safety.mjs";
const [project, region, account, service, accessMode = "iam"] =
  process.argv.slice(2);
if (!service) throw Error("usage: verify.mjs project region account service");
const data = inventory(project, region, account);
const report = inspectInventory(data.services, data.revisions);
const s = data.services.find((x) => x.metadata.name === service);
if (!s) throw Error("target service missing");
assertTarget(s, accessMode);
const policy = JSON.parse(
  gcloud([
    "run",
    "services",
    "get-iam-policy",
    service,
    `--project=${project}`,
    `--region=${region}`,
    `--account=${account}`,
    "--format=json",
  ]),
);
if (
  policy.bindings?.some((b) =>
    b.members?.some((m) => ["allUsers", "allAuthenticatedUsers"].includes(m)),
  )
)
  throw Error("public IAM binding forbidden");
fs.writeFileSync(
  "artifacts/cloud-run/po-token/preflight/post-deployment.json",
  JSON.stringify({ at: new Date().toISOString(), ...report }, null, 2),
);
console.log(
  JSON.stringify({
    url: s.status.url,
    retainedInstances: report.retainedInstances,
    services: report.services.length,
    revisions: report.revisions.length,
    ready: s.status.conditions.find((x) => x.type === "Ready")?.status,
  }),
);
