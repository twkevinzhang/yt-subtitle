const number = (v, fallback) => {
  const n = v === undefined ? fallback : Number(v);
  if (!Number.isFinite(n) || n < 0) throw Error("unknown scaling value");
  return n;
};
const annotations = (o) => o?.metadata?.annotations ?? {};
function minimum(a, key) {
  return number(a[key], 0);
}
function throttle(a) {
  const v = a["run.googleapis.com/cpu-throttling"];
  if (v !== undefined && v !== "true" && v !== "false")
    throw Error("unknown billing mode");
  return v !== "false";
}
const resources = (spec) =>
  (spec?.containers ?? []).map((c) => ({
    cpu: c.resources?.limits?.cpu ?? null,
    memory: c.resources?.limits?.memory ?? null,
    gpu: c.resources?.limits?.["nvidia.com/gpu"] ?? "0",
  }));
export function inspectInventory(services, revisions) {
  if (!Array.isArray(services) || !Array.isArray(revisions))
    throw Error("incomplete inventory");
  const rows = [];
  for (const s of services) {
    if (
      !s.metadata?.name ||
      !s.spec?.template ||
      !Array.isArray(s.status?.traffic)
    )
      throw Error("unknown service state");
    const a = annotations(s),
      t = s.spec.template,
      ta = annotations(t);
    if (
      a["run.googleapis.com/scalingMode"] &&
      a["run.googleapis.com/scalingMode"] !== "automatic"
    )
      throw Error("manual scaling is forbidden");
    if (
      minimum(a, "run.googleapis.com/minScale") !== 0 ||
      minimum(ta, "autoscaling.knative.dev/minScale") !== 0 ||
      !throttle(ta)
    )
      throw Error("unsafe service " + s.metadata.name);
    const owned = revisions.filter(
      (r) =>
        r.metadata?.labels?.["serving.knative.dev/service"] === s.metadata.name,
    );
    if (!owned.length) throw Error("missing revisions for " + s.metadata.name);
    const names = new Set(owned.map((r) => r.metadata.name));
    for (const traffic of s.status.traffic)
      if (traffic.revisionName && !names.has(traffic.revisionName))
        throw Error("traffic revision missing");
    rows.push({
      name: s.metadata.name,
      region: s.metadata.labels?.["cloud.googleapis.com/location"],
      minInstances: 0,
      maxInstances: a["run.googleapis.com/maxScale"] ?? "platform-default",
      resources: resources(t.spec),
      concurrency: t.spec?.containerConcurrency ?? 80,
      cpuThrottling: true,
      traffic: s.status.traffic,
      ready:
        s.status.conditions?.find((c) => c.type === "Ready")?.status ??
        "unknown",
    });
  }
  const revRows = revisions.map((r) => {
    const a = annotations(r);
    if (!r.metadata?.name || !r.spec || !r.status)
      throw Error("unknown revision state");
    if (minimum(a, "autoscaling.knative.dev/minScale") !== 0 || !throttle(a))
      throw Error("unsafe revision " + r.metadata.name);
    return {
      name: r.metadata.name,
      service: r.metadata.labels?.["serving.knative.dev/service"],
      minInstances: 0,
      maxInstances: a["autoscaling.knative.dev/maxScale"] ?? "platform-default",
      resources: resources(r.spec),
      concurrency: r.spec.containerConcurrency ?? 80,
      cpuThrottling: true,
      ready:
        r.status.conditions?.find((c) => c.type === "Ready")?.status ??
        "unknown",
    };
  });
  return {
    services: rows,
    revisions: revRows,
    retainedInstances: 0,
    retainedVcpu: 0,
    retainedMemoryGiB: 0,
  };
}
export function assertApproval(a, target) {
  if ((a.accessMode ?? "iam") !== (target.accessMode ?? "iam"))
    throw Error("access mode is not authorized");
  if (
    !a?.approved ||
    !Number.isFinite(Date.parse(a.expiresAt)) ||
    Date.parse(a.expiresAt) <= Date.now() ||
    !Number.isFinite(a.maxUsd) ||
    a.maxUsd <= 0 ||
    a.maxUsd > 3
  )
    throw Error("current explicit cost authorization required");
  for (const key of [
    "project",
    "region",
    "service",
    "cpu",
    "memoryMiB",
    "maxInstances",
  ])
    if (a[key] !== target[key])
      throw Error("authorization target mismatch: " + key);
}
export function assertCleanupApproval(a, target) {
  if (
    !a?.approved ||
    a.cleanupOnFailure !== true ||
    target.service !== "yt-subtitle-po-token"
  )
    throw Error("task cleanup is not authorized");
  // Expiry blocks new spending, never the cleanup already authorized by the human.
  for (const key of [
    "project",
    "region",
    "service",
    "cpu",
    "memoryMiB",
    "maxInstances",
  ])
    if (a[key] !== target[key]) throw Error("cleanup target mismatch: " + key);
}
export function renderService(c) {
  if (
    c.accessMode !== undefined &&
    !["iam", "anonymous"].includes(c.accessMode)
  )
    throw Error("invalid access mode");
  for (const [k, v] of Object.entries(c))
    if (!/^[A-Za-z0-9._/@:-]+$/.test(String(v)))
      throw Error("invalid config " + k);
  if (!c.image.includes("@sha256:"))
    throw Error("immutable image digest required");
  return {
    apiVersion: "serving.knative.dev/v1",
    kind: "Service",
    metadata: {
      name: c.service,
      annotations: {
        "run.googleapis.com/minScale": "0",
        "run.googleapis.com/maxScale": "1",
        "run.googleapis.com/ingress": "all",
        "run.googleapis.com/invoker-iam-disabled":
          c.accessMode === "anonymous" ? "true" : "false",
      },
    },
    spec: {
      template: {
        metadata: {
          annotations: {
            "autoscaling.knative.dev/minScale": "0",
            "autoscaling.knative.dev/maxScale": "1",
            "run.googleapis.com/cpu-throttling": "true",
            "run.googleapis.com/startup-cpu-boost": "false",
          },
        },
        spec: {
          ...(c.serviceAccount ? { serviceAccountName: c.serviceAccount } : {}),
          containerConcurrency: 1,
          timeoutSeconds: 30,
          containers: [
            {
              image: c.image,
              ports: [{ containerPort: 8080 }],
              resources: { limits: { cpu: "1", memory: "512Mi" } },
              env: [
                {
                  name: "AUTH_MODE",
                  value: c.accessMode === "anonymous" ? "anonymous" : "iam",
                },
              ],
            },
          ],
        },
      },
      traffic: [{ latestRevision: true, percent: 100 }],
    },
  };
}

export function assertTarget(s, accessMode = "iam") {
  const a = annotations(s),
    t = s.spec?.template,
    ta = annotations(t),
    spec = t?.spec;
  const limits = spec?.containers?.[0]?.resources?.limits;
  if (
    minimum(a, "run.googleapis.com/minScale") !== 0 ||
    minimum(ta, "autoscaling.knative.dev/minScale") !== 0 ||
    !throttle(ta) ||
    ta["run.googleapis.com/startup-cpu-boost"] !== "false" ||
    Number(a["run.googleapis.com/maxScale"]) !== 1 ||
    Number(ta["autoscaling.knative.dev/maxScale"]) !== 1 ||
    (a["run.googleapis.com/invoker-iam-disabled"] === "true") !==
      (accessMode === "anonymous") ||
    spec?.containerConcurrency !== 1 ||
    spec.timeoutSeconds !== 30 ||
    spec.containers.length !== 1 ||
    !["1", "1000m"].includes(limits?.cpu) ||
    limits?.memory !== "512Mi" ||
    Number(limits?.["nvidia.com/gpu"] ?? 0) !== 0 ||
    s.status?.conditions?.find((x) => x.type === "Ready")?.status !== "True" ||
    s.status?.traffic?.some((x) => x.tag) ||
    !s.status?.traffic?.some((x) => x.percent === 100)
  )
    throw Error("deployed target differs from approved settings");
}
