import { sendJson } from "../serverUtils.js";
import { systemCheck } from "../systemInspector.js";
import { getWorkbenchSettings, getNetworkSettings } from "../store.js";

export function register(route: (method: string, path: string, handler: (...args: any[]) => Promise<void>) => void) {
  route("GET", "/healthz", async (_req: any, res: any) => {
    sendJson(res, 200, { status: "ok", runtime: "node" });
  });

  route("GET", "/system/check", async (_req: any, res: any) => {
    const workbench = getWorkbenchSettings();
    sendJson(res, 200, {
      ...(await systemCheck()),
      management_url: "http://localhost:" + workbench.active_management_port,
      configured_management_url: "http://localhost:" + workbench.management_port,
      workbench,
      network: getNetworkSettings()
    });
  });
}
