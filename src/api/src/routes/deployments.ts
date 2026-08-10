import { readBody, sendJson } from "../serverUtils.js";
import { createDeploymentPlan as buildDeploymentPlan, startDeployment } from "../deploymentManager.js";
import { compatibilityFor, getModel, listModels } from "../modelRegistry.js";
import { proxyHttp, parseMaybeJson } from "../httpProxy.js";
import type { ModelRecord, ServiceType } from "../types.js";
import { listEngines, stopEngine, engineHealth } from "../engineManager.js";
import { listActiveDeployments, getActiveDeployment, deleteDeployment, upsertDeployment } from "../store.js";

export function register(
  route: (method: string, path: string, handler: (...args: any[]) => Promise<void>) => void,
  dh: any,
  modelsRoot: string,
  workspaceRoot: string,
  logsRoot: string
) {
  route("GET", "/deployments", async (_req: any, res: any) => {
    const configured = await dh.configuredDeployments();
    const active = await dh.liveActiveDeployments();
    sendJson(res, 200, { deployments: dh.mergeDeployments(configured, active) });
  });

  route("GET", "/deployments/:deployment_id", async (_req: any, res: any, params: any) => {
    const d = await dh.findDeployment(params.deployment_id);
    if (!d) return sendJson(res, 404, { detail: "Unknown deployment: " + params.deployment_id });
    sendJson(res, 200, d);
  });

  route("GET", "/deployments/:deployment_id/health", async (_req: any, res: any, params: any) => {
    const d = await dh.findDeployment(params.deployment_id);
    if (!d) return sendJson(res, 404, { detail: "Unknown deployment: " + params.deployment_id });
    const healthTarget = d.health_url ?? dh.runtimeHealthUrl(d.service_type);
    const result = await proxyHttp("GET", healthTarget);
    sendJson(res, result.ok ? 200 : 503, {
      deployment_id: d.deployment_id, service_type: d.service_type,
      status: result.ok ? "healthy" : "unavailable",
      target: healthTarget, response: parseMaybeJson(result.body.toString("utf-8"))
    });
  });

  route("POST", "/deployments/:deployment_id/stop", async (_req: any, res: any, params: any) => {
    // Stop the engine matching this deployment
    const engines = listEngines();
    const engine = engines.find((e) => `svc_${e.type}` === params.deployment_id);
    if (!engine) {
      const active = getActiveDeployment(params.deployment_id);
      if (active) deleteDeployment(params.deployment_id);
      return sendJson(res, 404, { detail: "No running engine matches deployment: " + params.deployment_id });
    }
    const result = await stopEngine(engine.id);
    deleteDeployment(params.deployment_id);
    sendJson(res, result.ok ? 200 : 500, { deployment_id: params.deployment_id, status: "stopped", detail: result.detail });
  });

  route("POST", "/deployments", async (req: any, res: any) => {
    const body = await readBody<{
      model_id?: string; service_type?: ServiceType; openai_model?: string;
      args?: Record<string, unknown>; start?: boolean
    }>(req);
    if (!body.model_id) return sendJson(res, 400, { detail: "model_id is required" });
    const serviceType = body.service_type ?? "chat";
    const model = await getModel(modelsRoot, body.model_id);
    if (!model) return sendJson(res, 404, { detail: "Unknown model: " + body.model_id });

    const deployment = (await dh.configuredDeployments()).find(
      (d: any) => d.service_type === serviceType
    );
    if (!deployment) return sendJson(res, 400, {
      detail: `Unknown service type: ${serviceType}. Available: chat, vision, asr, tts, embedding, rerank`
    });

    if (body.start) {
      try {
        sendJson(res, 202, await startDeployment(deployment, model, body, workspaceRoot, logsRoot));
      } catch (error) {
        sendJson(res, 500, { detail: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    sendJson(res, 200, buildDeploymentPlan(
      deployment, model, serviceType, body.openai_model ?? model.id, body.args ?? {}, workspaceRoot
    ));
  });

  route("POST", "/deployments/start", async (req: any, res: any) => {
    const body = await readBody<{
      model_id?: string; service_type?: ServiceType; openai_model?: string;
      args?: Record<string, unknown>
    }>(req);
    if (!body.model_id) return sendJson(res, 400, { detail: "model_id is required" });
    const serviceType = body.service_type ?? "chat";
    const model = await getModel(modelsRoot, body.model_id);
    if (!model) return sendJson(res, 404, { detail: "Unknown model: " + body.model_id });

    const deployment = (await dh.configuredDeployments()).find(
      (d: any) => d.service_type === serviceType
    );
    if (!deployment) return sendJson(res, 400, {
      detail: `Unknown service type: ${serviceType}. Available: chat, vision, asr, tts, embedding, rerank`
    });

    // Check if already running
    const existing = listActiveDeployments().find(
      (d: any) => d.service_type === serviceType && d.model_id === model.id && d.status === "running"
    );
    if (existing) {
      return sendJson(res, 200, { ...existing, status: "already_running", detail: "Deployment is already running." });
    }

    try {
      sendJson(res, 202, await startDeployment(deployment, model, body, workspaceRoot, logsRoot));
    } catch (error) {
      sendJson(res, 500, { detail: error instanceof Error ? error.message : String(error) });
    }
  });
}
