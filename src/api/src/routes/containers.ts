/**
 * Container routes — now redirect to engine endpoints.
 * Docker containers have been replaced by Python subprocess inference engines.
 */

import { readBody, sendJson } from "../serverUtils.js";
import { listContainers } from "../containerTasks.js";
import { listEngines } from "../engineManager.js";

export function register(
  route: (method: string, path: string, handler: (...args: any[]) => Promise<void>) => void,
  workspaceRoot: string,
  logsRoot: string,
  stateRoot: string
) {
  // GET /containers — returns engine status as container-compatible format
  route("GET", "/containers", async (_req: any, res: any) => {
    sendJson(res, 200, await listContainers());
  });

  // All other container endpoints redirect to engines
  route("GET", "/containers/:key/config", async (_req: any, res: any, params: any) => {
    sendJson(res, 200, {
      detail: "Container configuration has moved to engine endpoints.",
      engine_url: `/engines/${params.key}/start`
    });
  });

  route("POST", "/containers/:key/pull-image", async (_req: any, res: any, params: any) => {
    sendJson(res, 200, {
      detail: "AI Stack for Intel uses Python subprocess engines — no Docker images needed.",
      engine_url: `/engines/${params.key}/start`
    });
  });

  route("POST", "/containers/:key/test-image", async (_req: any, res: any, params: any) => {
    sendJson(res, 200, {
      detail: "Environment check: ensure openvino and openvino-genai are installed.",
      engine_url: `/engines/devices`
    });
  });

  route("POST", "/containers/:key/start-test", async (_req: any, res: any, params: any) => {
    sendJson(res, 200, {
      detail: "Use POST /engines/:type/start to start an inference engine.",
      engine_url: `/engines/${params.key}/start`
    });
  });

  route("POST", "/containers/custom", async (_req: any, res: any) => {
    sendJson(res, 200, {
      detail: "Custom container creation is not supported in AI Stack for Intel. Use engine presets."
    });
  });

  route("GET", "/containers/:name/logs", async (_req: any, res: any, params: any) => {
    sendJson(res, 200, {
      detail: "View engine task logs via GET /tasks/:task_id/logs",
      engine_url: `/engines`
    });
  });

  route("POST", "/containers/:name/:action", async (_req: any, res: any, params: any) => {
    sendJson(res, 200, {
      detail: `Use POST /engines/:id/${params.action === 'stop' ? 'stop' : 'start'} for engine lifecycle.`
    });
  });

  route("DELETE", "/containers/:key", async (_req: any, res: any, params: any) => {
    sendJson(res, 200, {
      detail: "Engine cleanup is handled via POST /engines/:id/stop"
    });
  });

  route("DELETE", "/containers/custom/:name", async (_req: any, res: any, params: any) => {
    sendJson(res, 200, { detail: "Custom containers are not supported." });
  });
}
