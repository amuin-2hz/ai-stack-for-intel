import { dirname, join } from "node:path";
import { stat } from "node:fs/promises";
import { readBody, sendJson } from "../serverUtils.js";
import {
  deleteModel, getModel, isModelPublished, listDeployments, listModels, compatibilityFor, servicePorts
} from "../modelRegistry.js";
import { listActiveDeployments, listModelFiles, listTasks } from "../store.js";
import { createDownloadPlan } from "../downloadManager.js";
import { runCommand } from "../utils.js";
import type { ServiceType } from "../types.js";

export function register(
  route: (method: string, path: string, handler: (...args: any[]) => Promise<void>) => void,
  modelsRoot: string,
  workspaceRoot: string
) {
  route("GET", "/models/progress", async (_req: any, res: any) => {
    const models = await listModels(modelsRoot);
    sendJson(res, 200, {
      models_dir: modelsRoot,
      model_count: models.length,
      models: models.map((m: any) => ({
        model: m.display_name, path: m.local.path, status: m.status.download,
        weight_files: m.local.weight_files, weight_bytes: m.local.size_bytes,
        config_files: m.local.config_files, incomplete_files: m.local.incomplete_files,
        lock_files: [] as string[]
      }))
    });
  });

  route("GET", "/models", async (_req: any, res: any) => {
    const models = await listModels(modelsRoot);
    sendJson(res, 200, { models_dir: modelsRoot, model_count: models.length, models });
  });

  route("GET", "/models/:model_id/files", async (_req: any, res: any, params: any) => {
    const model = await getModel(modelsRoot, params.model_id);
    if (!model) return sendJson(res, 404, { detail: "Unknown model: " + params.model_id });
    sendJson(res, 200, { model_id: params.model_id, files: listModelFiles(params.model_id) });
  });

  route("GET", "/models/:model_id", async (_req: any, res: any, params: any) => {
    const model = await getModel(modelsRoot, params.model_id);
    if (!model) return sendJson(res, 404, { detail: `Unknown model: ${params.model_id}` });
    sendJson(res, 200, model);
  });

  route("DELETE", "/models/:model_id", async (_req: any, res: any, params: any) => {
    const model = await getModel(modelsRoot, params.model_id);
    if (!model) return sendJson(res, 404, { detail: "Unknown model: " + params.model_id });

    const activeDeployment = listActiveDeployments().find(
      (d: any) => d.model_id === model.id && ["running", "starting", "configured"].includes(d.status)
    );
    if (activeDeployment)
      return sendJson(res, 409, { detail: "Model is currently deployed and cannot be deleted.", deployment: activeDeployment });

    const published = await isModelPublished(model.id);
    if (published.published)
      return sendJson(res, 409, { detail: `Model is currently served by the ${published.service_type} service and cannot be deleted. Stop the service or unload the model first.` });

    const activeTask = listTasks().find(
      (t: any) => ["queued", "running"].includes(t.status) &&
        (t.metadata?.model_id === model.id || t.metadata?.alias === model.id || t.metadata?.alias === model.display_name)
    );
    if (activeTask) return sendJson(res, 409, { detail: "Model has an active task and cannot be deleted.", task: activeTask });

    try {
      sendJson(res, 200, await deleteModel(modelsRoot, params.model_id));
    } catch (error) {
      sendJson(res, 400, { detail: error instanceof Error ? error.message : String(error) });
    }
  });

  route("POST", "/models/import", async (req: any, res: any) => {
    const body = await readBody<{ url?: string; alias?: string; provider?: string }>(req);
    if (!body.url) return sendJson(res, 400, { detail: "url is required" });
    sendJson(res, 200, createDownloadPlan({ url: body.url, alias: body.alias, provider: body.provider }, workspaceRoot));
  });

  route("POST", "/models/:model_id/open-folder", async (_req: any, res: any, params: any) => {
    const model = await getModel(modelsRoot, params.model_id);
    if (!model) return sendJson(res, 404, { detail: "Unknown model: " + params.model_id });
    const modelStat = await stat(model.local.path).catch(() => null);
    const folder = modelStat?.isFile() ? dirname(model.local.path) : model.local.path;
    const result = await runCommand("xdg-open", [folder], 3000);
    sendJson(res, result.ok ? 200 : 202, { folder, ok: result.ok, detail: result.stdout || result.stderr || "open requested" });
  });

  route("GET", "/runtimes", async (_req: any, res: any) => {
    const deployments = await listDeployments(modelsRoot);
    sendJson(res, 200, {
      runtimes: deployments.map((d: any) => ({
        service_type: d.service_type, runtime: d.runtime, status: d.status,
        public_port: d.public_port, base_url: d.base_url, health_url: d.health_url,
        container_name: d.container_name, openai_models: d.openai_models, warnings: d.warnings
      }))
    });
  });

  route("POST", "/runtimes/compatibility", async (req: any, res: any) => {
    const body = await readBody<{ model_id?: string; service_type?: ServiceType }>(req);
    if (!body.model_id || !body.service_type) return sendJson(res, 400, { detail: "model_id and service_type are required" });
    const model = await getModel(modelsRoot, body.model_id);
    if (!model) return sendJson(res, 404, { detail: `Unknown model: ${body.model_id}` });
    const compat = compatibilityFor(model, body.service_type);
    sendJson(res, 200, { status: compat.status, model_format: model.local.format, service_type: body.service_type, reason: compat.reason, warnings: compat.status === "compatible" ? [] : [compat.reason] });
  });
}
