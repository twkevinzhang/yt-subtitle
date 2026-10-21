import { spawnSync } from "node:child_process";
import path from "node:path";
export function gcloud(args, { timeout = 60000 } = {}) {
  // Invoke the SDK's bundled Python directly on Windows to avoid shell quoting.
  for (const a of args)
    if (!/^[A-Za-z0-9._/@:=,+\\-]+$/.test(a))
      throw Error("unsafe CLI argument");
  const sdk = path.join(
    process.env.LOCALAPPDATA ?? "",
    "Google/Cloud SDK/google-cloud-sdk",
  );
  const cmd =
    process.platform === "win32"
      ? path.join(sdk, "platform/bundledpython/python.exe")
      : "gcloud";
  const argv =
    process.platform === "win32"
      ? [path.join(sdk, "lib/gcloud.py"), ...args]
      : args;
  const r = spawnSync(cmd, argv, {
    encoding: "utf8",
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (r.status !== 0)
    throw Error("gcloud command failed: " + args.slice(0, 3).join(" "));
  return r.stdout.trim();
}
export function inventory(project, region, account) {
  const common = [
    `--project=${project}`,
    `--account=${account}`,
    "--format=json",
  ];
  const services = JSON.parse(
    gcloud(["run", "services", "list", "--platform=managed", ...common]),
  );
  const regions = [
    ...new Set(
      services.map((x) => x.metadata.labels["cloud.googleapis.com/location"]),
    ),
  ];
  if (!regions.includes(region)) regions.push(region);
  const revisions = regions.flatMap((r) =>
    JSON.parse(
      gcloud(["run", "revisions", "list", `--region=${r}`, ...common]),
    ),
  );
  return { services, revisions };
}
