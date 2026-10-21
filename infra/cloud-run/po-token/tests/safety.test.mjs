import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inspectInventory,
  assertApproval,
  assertCleanupApproval,
  renderService,
  assertTarget,
} from "../safety.mjs";

test("authorized failure cleanup remains available after deployment deadline", () => {
  const target = {
    project: "p",
    region: "asia-east1",
    service: "yt-subtitle-po-token",
    cpu: 1,
    memoryMiB: 512,
    maxInstances: 1,
  };
  const approval = {
    ...target,
    approved: true,
    cleanupOnFailure: true,
    maxUsd: 3,
    expiresAt: "2020-01-01T00:00:00Z",
  };
  assert.throws(() => assertApproval(approval, target));
  assert.doesNotThrow(() => assertCleanupApproval(approval, target));
  assert.throws(() =>
    assertCleanupApproval({ ...approval, project: "other" }, target),
  );
  assert.throws(() =>
    assertCleanupApproval({ ...approval, cleanupOnFailure: false }, target),
  );
});
const service = () => ({
  metadata: { name: "api", annotations: {} },
  spec: { template: { metadata: { annotations: {} }, spec: {} } },
  status: { traffic: [] },
});

test("post-deployment rejects resource, billing, readiness and tag drift", () => {
  const c = {
    service: "yt-po-token",
    image: "asia-east1-docker.pkg.dev/p/r/i@sha256:" + "a".repeat(64),
  };
  const make = () => ({
    ...renderService(c),
    status: {
      conditions: [{ type: "Ready", status: "True" }],
      traffic: [{ revisionName: "yt-po-token-00001", percent: 100 }],
    },
  });
  assert.doesNotThrow(() => assertTarget(make()));
  for (const mutate of [
    (s) => {
      s.spec.template.spec.containers[0].resources.limits.cpu = "2";
    },
    (s) => {
      s.spec.template.spec.timeoutSeconds = 300;
    },
    (s) => {
      s.metadata.annotations["run.googleapis.com/maxScale"] = "2";
    },
    (s) => {
      s.spec.template.metadata.annotations[
        "run.googleapis.com/cpu-throttling"
      ] = "false";
    },
    (s) => {
      s.status.conditions[0].status = "False";
    },
    (s) => {
      s.status.traffic[0].tag = "candidate";
    },
    (s) => {
      s.metadata.annotations["run.googleapis.com/invoker-iam-disabled"] =
        "true";
    },
  ]) {
    const s = make();
    mutate(s);
    assert.throws(() => assertTarget(s));
  }
});
const revision = (annotations = {}) => ({
  metadata: {
    name: "api-00001",
    labels: { "serving.knative.dev/service": "api" },
    annotations,
  },
  spec: {
    containers: [{ resources: { limits: { cpu: "1", memory: "512Mi" } } }],
  },
  status: { conditions: [{ type: "Ready", status: "True" }] },
});
test("accepts platform defaults with zero retained instances", () => {
  const r = inspectInventory([service()], [revision()]);
  assert.equal(r.retainedInstances, 0);
  assert.equal(r.revisions.length, 1);
});
test("rejects unsafe settings on every revision including unready and untagged ones", () => {
  for (const annotation of [
    { "autoscaling.knative.dev/minScale": "1" },
    { "run.googleapis.com/cpu-throttling": "false" },
    { "autoscaling.knative.dev/minScale": "unknown" },
  ]) {
    const bad = revision(annotation);
    bad.metadata.name = "old-failed";
    bad.status.conditions[0].status = "False";
    assert.throws(() => inspectInventory([service()], [revision(), bad]));
  }
});
test("rejects missing revisions and manual/service-level retained capacity", () => {
  assert.throws(() => inspectInventory([service()], []));
  for (const annotation of [
    { "run.googleapis.com/minScale": "1" },
    { "run.googleapis.com/scalingMode": "manual" },
  ]) {
    const s = service();
    s.metadata.annotations = annotation;
    assert.throws(() => inspectInventory([s], [revision()]));
  }
});
test("requires exact current cost authorization and matching target", () => {
  const config = {
    project: "project-id",
    region: "asia-east1",
    service: "yt-po-token",
    cpu: 1,
    memoryMiB: 512,
    maxInstances: 1,
  };
  const a = {
    approved: true,
    ...config,
    maxUsd: 3,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  assert.doesNotThrow(() => assertApproval(a, config));
  for (const changed of [
    { approved: false },
    { expiresAt: "2020-01-01" },
    { maxInstances: 2 },
    { project: "other" },
  ])
    assert.throws(() => assertApproval({ ...a, ...changed }, config));
});
test("deploy explicitly locks both min scopes and request-based billing", () => {
  const s = renderService({
    project: "project-id",
    region: "asia-east1",
    service: "yt-po-token",
    image:
      "asia-east1-docker.pkg.dev/project-id/image-hub/token@sha256:" +
      "a".repeat(64),
  });
  assert.equal(s.metadata.annotations["run.googleapis.com/minScale"], "0");
  assert.equal(s.metadata.annotations["run.googleapis.com/maxScale"], "1");
  assert.equal(
    s.metadata.annotations["run.googleapis.com/invoker-iam-disabled"],
    "false",
  );
  assert.equal(
    s.spec.template.metadata.annotations["autoscaling.knative.dev/minScale"],
    "0",
  );
  assert.equal(
    s.spec.template.metadata.annotations["run.googleapis.com/cpu-throttling"],
    "true",
  );
  assert.equal(s.spec.template.spec.containerConcurrency, 1);
  assert(!s.spec.traffic.some((x) => x.tag));
});

test("anonymous access requires an explicit matching human authorization", () => {
  const target = {
    project: "project-id",
    region: "asia-east1",
    service: "yt-po-token",
    cpu: 1,
    memoryMiB: 512,
    maxInstances: 1,
    accessMode: "anonymous",
  };
  const a = {
    ...target,
    approved: true,
    maxUsd: 3,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  assert.doesNotThrow(() => assertApproval(a, target));
  assert.throws(() => assertApproval({ ...a, accessMode: "iam" }, target));
  const s = renderService({
    service: target.service,
    accessMode: "anonymous",
    image: "a@sha256:" + "a".repeat(64),
  });
  assert.equal(
    s.metadata.annotations["run.googleapis.com/invoker-iam-disabled"],
    "true",
  );
  assert.equal(s.spec.template.spec.containers[0].env[0].value, "anonymous");
  assert.throws(() =>
    renderService({
      service: target.service,
      accessMode: "unknown",
      image: "a@sha256:" + "a".repeat(64),
    }),
  );
});
