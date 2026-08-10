/**
 * Deployment manager — adapted for LocalRuntime engine lifecycle.
 * Starts inference engines as subprocesses instead of Docker containers.
 */

import { join } from "node:path";
import { createTask, runManagedCommand } from "./taskRunner.js";
import { createTask as persistTask, getTask, updateTask, upsertDeployment } from "./store.js";
import { startEngine, engineHealth } from "./engineManager.js";
import type { ActiveDeploymentRecord, DeploymentRecord, ModelRecord, ServiceType } from "./types.js";
import type { EngineType } from "./engineManager.js";

/* ── types ────────────────────────────────────────── */
export interface DeploymentRequest {
  service_type?: ServiceType;
  openai_model?: string;
  args?: Record<string, unknown>;
}

/* ── port map ─────────────────────────────────────── */
function defaultPortFor(engineType: string): number {
  const ports: Record<string, number> = { chat: 31000, vision: 31001, asr: 31002, tts: 31003, embedding: 31004, rerank: 31005 };
  return ports[engineType] ?? 31000;
}

function engineTypeFor(serviceTypeStr: string): EngineType {
  const map: Record<string, EngineType> = {
    vllm: "chat", trtllm: "chat", pytorch: "asr",
    chat: "chat", vision: "vision", asr: "asr", tts: "tts", embedding: "embedding", rerank: "rerank"
  };
  return map[serviceTypeStr] ?? "chat";
}

/* ── deployment plan ──────────────────────────────── */
export function createDeploymentPlan(
  deployment: DeploymentRecord,
  model: ModelRecord,
  serviceType: ServiceType,
  openaiModel: string,
  args: Record<string, unknown>,
  baseDir: string
) {
  const engineType = engineTypeFor(serviceType);
  const port = defaultPortFor(engineType);

  return {
    ...deployment,
    deployment_id: `plan_${model.id}_${engineType}`,
    model_id: model.id,
    status: "planned",
    public_port: port,
    base_url: `http://localhost:${port}`,
    health_url: `http://localhost:${port}/health`,
    engine_type: engineType,
    openai_models: [openaiModel],
    compatibility: model.compatibility as any,
    launch: {
      mode: "managed_task" as const,
      env: {} as Record<string, string>,
      command: `python3 src/inference/${engineType === "chat" ? "chat" : engineType === "vision" ? "vision" : engineType === "asr" ? "asr" : engineType === "tts" ? "tts_qwen" : engineType === "embedding" ? "embeddings" : "rerank"}.py --port ${port} --model-path models/${model.display_name}`,
      working_directory: baseDir,
      notes: [`${engineType} engine on port ${port}`]
    },
    stages: [
      { id: "prepare" as const, label: "Resolve device", detail: "Detect available devices (NPU/GPU/CPU)." },
      { id: "start" as const, label: "Spawn engine", detail: `Start ${engineType} subprocess on port ${port}.` },
      { id: "health" as const, label: "Health check", detail: "Wait for engine to become healthy." }
    ],
    args
  };
}

/* ── start deployment ─────────────────────────────── */
export async function startDeployment(
  deployment: DeploymentRecord,
  model: ModelRecord,
  request: DeploymentRequest,
  baseDir: string,
  logsRoot: string
) {
  const engineType = engineTypeFor(request.service_type ?? "chat");
  const openaiModel = request.openai_model ?? model.id;
  const port = defaultPortFor(engineType);

  const task = createTask("deploy",
    `Start ${engineType} engine for ${model.display_name}`,
    baseDir,
    join(logsRoot, "tasks", `deploy-${model.id}-${engineType}.log`),
    { model_id: model.id, engine_type: engineType, openai_model: openaiModel, port }
  );
  persistTask(task);

  try {
    const engine = await startEngine({
      type: engineType,
      model_id: model.id,
      model_name: model.display_name,
      model_path: model.local.path,
      port,
      workspaceRoot: baseDir,
      logsRoot
    });

    const activeRec = activeDeploymentFor(engine);
    upsertDeployment(activeRec);

    await updateTask(task.id, { status: "succeeded", updated_at: new Date().toISOString() });
    return { ...deployment, status: "running", task, engine };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await updateTask(task.id, { status: "failed", error: msg, updated_at: new Date().toISOString() });
    throw error;
  }
}

function activeDeploymentFor(engine: ReturnType<typeof import("./engineManager.js").startEngine> extends Promise<infer T> ? T : never): ActiveDeploymentRecord {
  const now = new Date().toISOString();
  return {
    deployment_id: `svc_${engine.type}`,
    model_id: engine.model_id,
    service_type: engine.type as any,
    runtime: engine.type,
    container_name: null,
    public_port: engine.port,
    base_url: `http://localhost:${engine.port}`,
    health_url: `http://localhost:${engine.port}/health`,
    worker_endpoint: `http://127.0.0.1:${engine.port}`,
    openai_model: engine.model_name,
    status: "running",
    task_id: undefined,
    updated_at: now
  };
}
