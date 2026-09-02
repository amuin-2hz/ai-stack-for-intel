/**
 * Author: zhenz
 */

import { access } from "node:fs/promises";
import { listEngines, startEngine, enginePresets, type EngineType } from "./engineManager.js";
import { proxyHttp, requestAudioWebSocket } from "./httpProxy.js";
import { listModels, findModelByName, publishedModelNameFor } from "./modelRegistry.js";
import { systemCheck } from "./systemInspector.js";

export interface ToolExecutorDeps {
  modelsRoot: string;
  workspaceRoot: string;
  logsRoot: string;
}

export interface ToolExecutionResult {
  ok: boolean;
  content: unknown;
}

/**
 * Create the built-in tool executor used by the OpenAI-compatible tool runtime.
 */
export function createToolExecutor(deps: ToolExecutorDeps) {
  const { modelsRoot, workspaceRoot, logsRoot } = deps;

  /**
   * Execute one supported built-in tool and return a structured result payload.
   */
  async function executeTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolExecutionResult> {
    switch (toolName) {
      case "getRuntimeStatus":
        return { ok: true, content: await systemCheck() };
      case "listLocalModels":
        return { ok: true, content: await executeListLocalModels(args) };
      case "getEngineStatus":
        return { ok: true, content: await executeGetEngineStatus(args) };
      case "transcribeLocalAudio":
        return { ok: true, content: await executeTranscribeLocalAudio(args) };
      default:
        throw new Error(`Unsupported tool "${toolName}".`);
    }
  }

  /**
   * List ready models, optionally filtered by capability.
   */
  async function executeListLocalModels(args: Record<string, unknown>): Promise<unknown> {
    const capability = typeof args.capability === "string" ? args.capability : null;
    const models = await listModels(modelsRoot);
    return models
      .filter((model) => model.status.download === "ready")
      .filter((model) => !capability || model.capabilities.includes(capability))
      .map((model) => ({
        id: publishedModelNameFor(model),
        modelId: model.id,
        displayName: model.display_name,
        capabilities: model.capabilities,
        downloadStatus: model.status.download,
        localPath: model.local.path
      }));
  }

  /**
   * Report the status of running engines, optionally filtered by engine type.
   */
  async function executeGetEngineStatus(args: Record<string, unknown>): Promise<unknown> {
    const engineType = typeof args.engineType === "string" ? args.engineType : null;
    return listEngines()
      .filter((engine) => !engineType || engine.type === engineType)
      .map((engine) => ({
        id: engine.id,
        type: engine.type,
        modelId: engine.model_id,
        modelName: engine.model_name,
        device: engine.device,
        port: engine.port,
        status: engine.status,
        pid: engine.pid,
        startedAt: engine.started_at,
        error: engine.error ?? null
      }));
  }

  /**
   * Run the ASR engine against a local audio file path and return transcription JSON.
   */
  async function executeTranscribeLocalAudio(args: Record<string, unknown>): Promise<unknown> {
    const audioPath = String(args.audioPath ?? "").trim();
    if (!audioPath) {
      throw new Error("audioPath is required for transcribeLocalAudio.");
    }
    await access(audioPath);

    const requestedModel = typeof args.model === "string" && args.model.trim() ? args.model.trim() : "asr";
    const resolvedModel = await findModelByName(modelsRoot, requestedModel)
      ?? await findModelByName(modelsRoot, "asr");
    if (!resolvedModel) {
      throw new Error("No ASR model is available for transcribeLocalAudio.");
    }

    let engine = listEngines().find((candidate) =>
      candidate.type === "asr"
      && candidate.status === "running"
      && (candidate.model_id === resolvedModel.id || candidate.model_name === publishedModelNameFor(resolvedModel))
    );

    if (!engine) {
      const preset = enginePresets.find((candidate) => candidate.type === "asr");
      if (!preset) {
        throw new Error("No ASR engine preset is registered.");
      }
      engine = await startEngine({
        type: "asr",
        model_id: resolvedModel.id,
        model_name: publishedModelNameFor(resolvedModel),
        model_path: resolvedModel.local.path,
        port: preset.default_port,
        workspaceRoot,
        logsRoot
      });
    }

    if (engine.status !== "running") {
      throw new Error("ASR engine is not running.");
    }

    const language = typeof args.language === "string" ? args.language : "auto";
    const body = {
      model: publishedModelNameFor(resolvedModel),
      audio_path: audioPath,
      language
    };
    const result = await requestAudioWebSocket(
      `ws://127.0.0.1:${engine.port}/v1/audio/transcriptions`,
      body,
      "transcription",
      120_000
    );

    if (result.status >= 400) {
      const payload = safeJsonParse(result.body.toString("utf-8"));
      const message = payload && typeof payload === "object" && "error" in payload
        ? JSON.stringify(payload)
        : result.body.toString("utf-8");
      throw new Error(message);
    }

    if ((result.contentType || "").includes("application/json")) {
      return safeJsonParse(result.body.toString("utf-8"));
    }

    const fallback = await proxyHttp(
      "POST",
      `http://127.0.0.1:${engine.port}/v1/audio/transcriptions`,
      JSON.stringify(body),
      { "content-type": "application/json" },
      120_000
    );
    return safeJsonParse(fallback.body.toString("utf-8"));
  }

  return {
    executeTool
  };
}

/**
 * Parse arbitrary JSON text safely.
 */
function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { message: value };
  }
}
