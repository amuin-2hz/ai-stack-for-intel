import { readBody, sendJson } from "../serverUtils.js";
import { getWorkbenchSettings, setManagementPort, getNetworkSettings, setNetworkAccess } from "../store.js";

export function register(route: (method: string, path: string, handler: (...args: any[]) => Promise<void>) => void) {
  route("GET", "/settings/workbench", async (_req: any, res: any) => {
    sendJson(res, 200, getWorkbenchSettings());
  });

  route("POST", "/settings/workbench", async (req: any, res: any) => {
    const body = await readBody<{ management_port?: number }>(req);
    try {
      sendJson(res, 200, setManagementPort(Number(body.management_port)));
    } catch (error) {
      sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) });
    }
  });

  route("GET", "/settings/network", async (_req: any, res: any) => {
    sendJson(res, 200, getNetworkSettings());
  });

  route("POST", "/settings/network", async (req: any, res: any) => {
    const body = await readBody<{ lan_access_enabled?: boolean }>(req);
    if (typeof body.lan_access_enabled !== "boolean")
      return sendJson(res, 400, { detail: "lan_access_enabled boolean is required" });
    sendJson(res, 200, setNetworkAccess(body.lan_access_enabled));
  });
}
