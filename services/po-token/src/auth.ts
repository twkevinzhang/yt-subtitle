// In IAM mode Cloud Run verifies the caller before it reaches the container.
// Anonymous mode intentionally allows public use; deployment must separately
// authorize that mode. Neither CORS nor a key embedded in an extension is auth.
export const authorizeRequest = () => true;
