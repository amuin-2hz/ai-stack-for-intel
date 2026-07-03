/**
 * Engine routes — manage LocalRuntime inference engines.
 * Replaces the Docker container routes with subprocess engine management.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readBody, sendJson } from "../serverUtils.js";
import {
  listEngines, getEngine, startEngine, stopEngine, engineHealth,
  enginePresets, detectDevices
} from "../engineManager.js";
import { listModels } from "../modelRegistry.js";
import { createTask } from "../taskRunner.js";
import { createTask as persistTask, updateTask } from "../store.js";
import type { EngineRecord } from "../engineManager.js";


async function writeTaskLog(logPath: string, lines: string[]): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, lines.join("\n") + "\n", "utf-8");
}

async function createEngineTask(params: {
  action: "start" | "stop";
  engineType: string;
  workspaceRoot: string;
  logsRoot: string;
  modelId?: string;
  modelName?: string;
  device?: string;
  port?: number;
  engineId?: string;
}) {
  const title = params.action === "start" ? "启动引擎" : "停止引擎";
  const alias = `${title} ${params.engineType.toUpperCase()}`;
  const task = createTask(
    "container",
    `engine ${params.action} ${params.engineType}`,
    params.workspaceRoot,
    join(params.logsRoot, "tasks", `engine-${params.engineType}-${params.action}-${Date.now()}.log`),
    {
      action: params.action,
      alias,
      name: params.engineType.toUpperCase(),
      image: "OpenVINO",
      engine_type: params.engineType,
      engine_id: params.engineId,
      model_id: params.modelId,
      model_name: params.modelName,
      device: params.device,
      port: params.port
    }
  );
  persistTask(task);
  await updateTask(task.id, { status: "running" });
  await writeTaskLog(task.log_path, [
    `[${new Date().toISOString()}] ${alias}`,
    `action=${params.action}`,
    `engine=${params.engineType}`,
    params.modelName ? `model=${params.modelName}` : "",
    params.device ? `device=${params.device}` : "",
    params.port ? `port=${params.port}` : ""
  ].filter(Boolean));
  return task;
}

async function completeEngineTask(
  taskId: string,
  logPath: string,
  ok: boolean,
  detail: string,
  extra: string[] = [],
  metadata?: Record<string, unknown>
) {
  await writeTaskLog(logPath, [
    `[${new Date().toISOString()}] ${ok ? "succeeded" : "failed"}`,
    detail,
    ...extra
  ]);
  await updateTask(taskId, { status: ok ? "succeeded" : "failed", error: ok ? undefined : detail, ...(metadata ? { metadata } : {}) });
}

export function register(
  route: (method: string, path: string, handler: (...args: any[]) => Promise<void>) => void,
  modelsRoot: string,
  workspaceRoot: string,
  logsRoot: string
) {
  /* ── Static routes (BEFORE parameterized) ──── */

  /* ── List engines ──────────────────────────── */
  route("GET", "/engines", async (_req: any, res: any) => {
    const engines = listEngines();
    const enriched = await Promise.all(engines.map(async (e) => ({
      ...e,
      health: await engineHealth(e)
    })));
    sendJson(res, 200, { engines: enriched });
  });

  /* ── Engine presets ────────────────────────── */
  route("GET", "/engines/presets", async (_req: any, res: any) => {
    sendJson(res, 200, { presets: enginePresets });
  });

  /* ── Device detection ──────────────────────── */
  route("GET", "/engines/devices", async (_req: any, res: any) => {
    sendJson(res, 200, await detectDevices());
  });

  /* ── Stop all engines ──────────────────────── */
  route("POST", "/engines/stop-all", async (_req: any, res: any) => {
    const { stopAllEngines } = await import("../engineManager.js");
    const stopped = await stopAllEngines();
    sendJson(res, 200, { stopped });
  });

  /* ── Parameterized routes ──────────────────── */

  /* ── Start engine by type ──────────────────── */
  route("POST", "/engines/:type/start", async (req: any, res: any, params: any) => {
    const engineType = params.type as string;
    const preset = enginePresets.find((p) => p.type === engineType);
    if (!preset) {
      return sendJson(res, 400, {
        detail: `Unknown engine type: ${engineType}. Available: ${enginePresets.map((p) => p.type).join(", ")}`
      });
    }

    const body = await readBody<{
      model_id?: string;
      device?: "NPU" | "GPU" | "CPU";
      port?: number;
    }>(req);

    // Resolve model
    let modelName = body.model_id ?? preset.default_model;
    let modelPath = "";
    let modelCompat: Record<string, { status: string; reason: string }> | undefined;
    try {
      const models = await listModels(modelsRoot);
      const model = models.find((m) =>
        m.id === modelName || m.display_name === modelName
      );
      if (model) {
        modelPath = model.local.path;
        modelName = model.display_name;
        modelCompat = model.compatibility as Record<string, { status: string; reason: string }>;
      } else {
        return sendJson(res, 404, {
          detail: `Model "${body.model_id}" not found in models directory.`,
          available_models: models.map((m) => m.display_name)
        });
      }
    } catch {
      return sendJson(res, 500, { detail: "Failed to list models." });
    }

    // Validate model-engine compatibility
    if (modelCompat) {
      const compat = modelCompat[engineType];
      if (compat?.status === "unsupported") {
        const supported = Object.entries(modelCompat)
          .filter(([, v]) => v.status !== "unsupported")
          .map(([k]) => k);
        return sendJson(res, 400, {
          detail: `Model "${modelName}" is not compatible with ${engineType} engine. ${compat.reason}` +
            (supported.length ? `\nCompatible engines: ${supported.join(", ")}` : "")
        });
      }
    }

    const requestedDevice = body.device;
    const requestedPort = body.port ?? preset.default_port;
    const lifecycleTask = await createEngineTask({
      action: "start",
      engineType,
      workspaceRoot,
      logsRoot,
      modelId: body.model_id ?? preset.default_model,
      modelName,
      device: requestedDevice,
      port: requestedPort
    });

    try {
      const engine = await startEngine({
        type: engineType as any,
        model_id: body.model_id ?? preset.default_model,
        model_name: modelName,
        model_path: modelPath,
        device: body.device,
        port: body.port,
        workspaceRoot,
        logsRoot
      });
      const health = await engineHealth(engine);
      const ok = engine.status === "running" && health.healthy;
      await completeEngineTask(lifecycleTask.id, lifecycleTask.log_path, ok, ok ? "Engine started." : (engine.error ?? health.detail), [
        `engine_id=${engine.id}`,
        `status=${engine.status}`,
        `health=${health.detail}`,
        `port=${engine.port}`,
        `device=${engine.device}`
      ], {
        ...lifecycleTask.metadata,
        engine_id: engine.id,
        device: engine.device,
        port: engine.port
      });
      sendJson(res, 200, { engine, health, task: lifecycleTask });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await completeEngineTask(lifecycleTask.id, lifecycleTask.log_path, false, detail);
      sendJson(res, 500, { detail, task: lifecycleTask });
    }
  });

  /* ── Engine health ─────────────────────────── */
  route("GET", "/engines/:id/health", async (_req: any, res: any, params: any) => {
    const engine = getEngine(params.id);
    if (!engine) return sendJson(res, 404, { detail: `Unknown engine: ${params.id}` });
    const health = await engineHealth(engine);
    sendJson(res, health.healthy ? 200 : 503, { engine_id: params.id, ...health });
  });

  /* ── Stop engine ───────────────────────────── */
  route("POST", "/engines/:id/stop", async (_req: any, res: any, params: any) => {
    const engine = getEngine(params.id) as EngineRecord | undefined;
    const lifecycleTask = await createEngineTask({
      action: "stop",
      engineType: engine?.type ?? "unknown",
      workspaceRoot,
      logsRoot,
      modelId: engine?.model_id,
      modelName: engine?.model_name,
      device: engine?.device,
      port: engine?.port,
      engineId: params.id
    });
    const result = await stopEngine(params.id);
    await completeEngineTask(lifecycleTask.id, lifecycleTask.log_path, result.ok, result.detail, [
      `engine_id=${params.id}`,
      engine ? `status=${engine.status}` : "status=unknown"
    ]);
    sendJson(res, result.ok ? 200 : 404, { ...result, task: lifecycleTask });
  });

  /* ── Get single engine (LAST — catches unmatched IDs) ── */
  route("GET", "/engines/:id", async (_req: any, res: any, params: any) => {
    const engine = getEngine(params.id);
    if (!engine) return sendJson(res, 404, { detail: `Unknown engine: ${params.id}` });
    const health = await engineHealth(engine);
    sendJson(res, 200, { ...engine, health });
  });
}
