import type { IncomingMessage } from "node:http";

/** Detect if request originates from localhost (Electron). */
export function isLocalRequest(req: IncomingMessage): boolean {
  const addr = req.socket?.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

/** Detect if request carries Electron's internal token. */
export function isElectronRequest(req: IncomingMessage): boolean {
  const token = req.headers["x-ai-stack-electron"] as string | undefined;
  return token === process.env.ELECTRON_TOKEN || isLocalRequest(req);
}

/** APIs that require Electron-level privilege (not available to LAN browser). */
const PRIVILEGED_PATHS: Array<{ method: string; path: string }> = [
  { method: "DELETE", path: "/models/" },
  { method: "POST", path: "/settings/" },
  { method: "DELETE", path: "/containers/" },
  { method: "POST", path: "/containers/custom" },
];

export function requiresElectronPrivilege(method: string, path: string): boolean {
  return PRIVILEGED_PATHS.some(
    (p) => method === p.method && path.startsWith(p.path)
  );
}
