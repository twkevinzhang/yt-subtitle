# PO Token service

Independent Node 24 package; install with `npm ci`, then `npm test`,
`npm run typecheck`, `npm run build`. Build the Linux container from the repo root:
`docker build -f services/po-token/Dockerfile services/po-token`.
Canvas is built for Linux inside the image. Never copy Windows node_modules.

`GET /healthz` makes no external calls. `POST /v1/po-token` accepts only
`{"videoId":"e1ZMmRlsaaU"}` and returns videoId, base64url poToken and expiresAt.
Responses are no-store. A single worker handles one request and is terminated
on cancellation, completion or the 20-second deadline. No persistent token cache,
no media proxy, no background CPU and no logged tokens.

The container **requires Cloud Run IAM invocation authentication**; IAM is enforced
before requests reach this application. Do not grant allUsers or
allAuthenticatedUsers, disable the invoker IAM check, or publicly expose this
container elsewhere. The caller supplies a short-lived identity token for the
service audience. No Google account credentials are embedded in the extension.

See `../../infra/cloud-run/po-token/` for safety-gated deployment and inventory.
Third-party adapted provider code is GPL-3.0-only; see vendor/bgutil.
