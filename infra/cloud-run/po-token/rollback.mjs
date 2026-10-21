import fs from "node:fs";
import { gcloud, inventory } from "./gcloud.mjs";
import { inspectInventory, assertCleanupApproval } from "./safety.mjs";
const [configFile, approvalFile] = process.argv.slice(2);
if (!configFile || !approvalFile)
  throw Error("usage: rollback.mjs config.json approval.json");
const c = JSON.parse(fs.readFileSync(configFile, "utf8")),
  a = JSON.parse(fs.readFileSync(approvalFile, "utf8"));
assertCleanupApproval(a, { ...c, cpu: 1, memoryMiB: 512, maxInstances: 1 });
if (
  c.service !== "yt-subtitle-po-token" ||
  !c.image.startsWith(
    `${c.region}-docker.pkg.dev/${c.project}/image-hub/yt-subtitle-po-token@sha256:`,
  )
)
  throw Error("cleanup only supports this task service/image");
const data = inventory(c.project, c.region, c.account);
let before;
try {
  before = inspectInventory(data.services, data.revisions);
} catch (error) {
  before = { unsafe: String(error), cleanupOnly: true };
}
// For this new, isolated service, rollback is complete deletion; no shared
// production service traffic, tags, repositories or images are changed.
gcloud([
  "run",
  "services",
  "delete",
  c.service,
  `--project=${c.project}`,
  `--region=${c.region}`,
  `--account=${c.account}`,
  "--quiet",
]);
const imagePackage = c.image.split("@")[0];
const images = JSON.parse(
  gcloud([
    "artifacts",
    "docker",
    "images",
    "list",
    imagePackage,
    `--project=${c.project}`,
    `--account=${c.account}`,
    "--format=json",
  ]),
);
// Remove parent indices before their image/attestation manifests. This package
// belongs solely to this task; the shared repository and other packages stay.
images.sort(
  (x, y) =>
    Number(y.metadata?.mediaType?.includes("index")) -
    Number(x.metadata?.mediaType?.includes("index")),
);
for (const image of images) {
  const digest = image.version?.split("/").at(-1);
  if (image.package !== imagePackage || !/^sha256:[a-f0-9]{64}$/.test(digest))
    throw Error("unexpected cleanup image scope");
  gcloud([
    "artifacts",
    "docker",
    "images",
    "delete",
    `${imagePackage}@${digest}`,
    `--project=${c.project}`,
    `--account=${c.account}`,
    "--delete-tags",
    "--quiet",
  ]);
}
const afterData = inventory(c.project, c.region, c.account),
  after = inspectInventory(afterData.services, afterData.revisions);
fs.writeFileSync(
  "artifacts/cloud-run/po-token/preflight/cleanup.json",
  JSON.stringify({ at: new Date().toISOString(), before, after }, null, 2),
);
console.log("Task service and image removed; remaining inventory checked.");
