export function readConfig(env = process.env) {
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("invalid PORT");
  const authMode = env.AUTH_MODE ?? "iam";
  if (!["iam", "anonymous"].includes(authMode))
    throw new Error("invalid AUTH_MODE");
  return { port, deadlineMs: 20_000, authMode };
}
