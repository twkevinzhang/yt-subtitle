// Cloud Run's IAM invoker gate authenticates requests before they reach the
// container. Deployment verification must reject invoker-iam-disabled and public
// allUsers/allAuthenticatedUsers bindings. Do not expose the container directly.
export const authorizeIamRequest = () => true;
