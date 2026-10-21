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

The public extension uses anonymous HTTPS invocation (`AUTH_MODE=anonymous`),
explicitly selected by the owner. No login or shared secret is embedded in the
extension. Cloud Run's invoker IAM check is disabled for this deployment.
Private deployments may instead retain the default `AUTH_MODE=iam` and require
gateway IAM authentication. The application itself does not validate IAM tokens.
Generation is limited to one active worker and six starts per rolling minute
per process. This resets on restart and is neither a global quota nor a billing cap.

See `../../infra/cloud-run/po-token/` for safety-gated deployment and inventory.
Third-party adapted provider code is GPL-3.0-only; see vendor/bgutil.
