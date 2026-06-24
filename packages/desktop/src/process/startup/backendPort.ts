export const DEFAULT_DEV_BACKEND_PORT = 51441;

export function resolvePreferredBackendPort(
  env: NodeJS.ProcessEnv = process.env,
  isPackaged = false
): number | undefined {
  const raw =
    env.AIONUI_DEV_BACKEND_PORT ??
    env.AIONUI_BACKEND_PORT ??
    (!isPackaged && env.NODE_ENV === 'development' ? String(DEFAULT_DEV_BACKEND_PORT) : undefined);
  if (!raw) return undefined;
  const port = Number.parseInt(raw, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return undefined;
  return port;
}
