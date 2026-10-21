# Cloud Run deployment

All commands below run from the repository root. The scripts never deploy during
extension install, test or build. No service keys or tokens are committed.

1. `node infra/cloud-run/po-token/preflight.mjs PROJECT REGION ACCOUNT`
   inventories all services and revisions (including tags and failed revisions)
   and saves sanitized resource fields under artifacts/cloud-run/po-token.
2. Build locally from services/po-token. Run local/mock tests before any external
   smoke. Cloud Build, jobs and load tests are not part of this deployment.
3. Record current official prices, FX, incremental cost, limits, cleanup and the
   user's explicit resource/cost authorization. A config JSON names project,
   region, account, service and immutable image. A separate approval JSON must
   contain approved=true, exact matching project/region/service, cpu=1,
   memoryMiB=512, maxInstances=1, maxUsd<=3 and a future expiresAt.
4. `node infra/cloud-run/po-token/deploy.mjs CONFIG_FILE APPROVAL_FILE`
   rechecks live inventory, snapshots configuration and approval, and replaces
   the service with min=0 at both scopes, max=1, throttling=true, CPU boost=false,
   concurrency=1, 30s timeout and no tags. Requires an existing image. Both config
   and human approval must explicitly match accessMode=anonymous to disable the
   invoker IAM check; otherwise private IAM is retained.
5. `node infra/cloud-run/po-token/verify.mjs PROJECT REGION ACCOUNT SERVICE anonymous`
   verifies all revisions and rejects public IAM bindings; then run at most the
   authorized number of remote smoke calls. API success alone is insufficient:
   verify actual extension-to-service requests and consecutive nonzero PCM windows.
6. On failed cross-IP validation stop integration. For this newly created service,
   `node infra/cloud-run/po-token/rollback.mjs CONFIG_FILE APPROVAL_FILE` deletes
   only yt-subtitle-po-token and images in its dedicated package. No existing service is
   changed. Preserve the snapshots and reconcile delayed Monitoring/Billing.

The approval file records human authorization; generating one is not itself
authorization. maxUsd is an operational stopping limit, not a GCP billing cap.
An expired approval cannot authorize a new deployment. Previously authorized
failure cleanup remains available after expiry and is restricted to the exact
task resources. Safety violations stop deployments; read-only inventory and
already authorized cleanup of this isolated task remain available.

Missing v1 minScale annotations use the documented default 0; missing
cpu-throttling uses documented request-based default. Unknown explicit values
are rejected. Root tests: `node --test infra/cloud-run/po-token/tests/safety.test.mjs`.
