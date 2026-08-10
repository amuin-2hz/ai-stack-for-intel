/**
 * OpenAI-compatible proxy — adapted for LocalRuntime.
 * Instead of proxying to Docker containers, requests go to Python inference
 * subprocesses managed by the engine manager.
 */

import type { ServerResponse } from "node:http";
import { createDeploymentHelpers } from "./deploymentHelpers.js";
import { startEngine, listEngines, enginePresets, type EngineType } from "./engineManager.js";
import { getModel, listModels } from "./modelRegistry.js";
import { proxyHttp } from "./httpProxy.js";

export interface OpenAIProxyDeps {
  modelsRoot: string;
  workspaceRoot: string;
  logsRoot: string;
  deploymentHelpers: ReturnType<typeof createDeploymentHelpers>;
}

export function createOpenAiProxy(deps: OpenAIProxyDeps) {
  const { modelsRoot, workspaceRoot, logsRoot } = deps;

  async function proxyOpenAiRequest(
    res: ServerResponse,
    body: Record<string, unknown>,
    path: string,
    rawBody?: string
  ): Promise<void> {
    const modelId = String(body.model ?? "");
    if (!modelId) {
      sendJsonProxy(res, 400, { error: { message: "model is required" } });
      return;
    }

    // Find running engine that serves this model
    let engine = findEngineForModel(modelId);

    // If no engine running, try to auto-start one
    if (!engine) {
      engine = await autoStartEngine(modelId);
    }

    if (!engine || engine.status !== "running") {
      const engines = listEngines().filter((e) => e.status === "running");
      sendJsonProxy(res, 404, {
        error: {
          message: `Model "${modelId}" is not loaded on any running engine.`,
          available_models: engines.map((e) => e.model_name)
        }
      });
      return;
    }

    const baseUrl = `http://127.0.0.1:${engine.port}/v1`;

    // Use raw body if available (preserves exact JSON), otherwise re-stringify
    const requestBody = rawBody ?? JSON.stringify(body);

    // Stream SSE if requested
    if (body.stream === true) {
      return proxyStreamRaw(res, baseUrl + path, requestBody);
    }

    // Pick a timeout appropriate for the endpoint:
    // TTS can take up to 2 min for very long text; ASR/chat are quicker.
    const timeout = path.includes("speech") ? 120_000
                  : path.includes("transcriptions") ? 30_000
                  : path.includes("embeddings") || path.includes("rerank") ? 60_000
                  : 60_000;

    const result = await proxyHttp(
      "POST",
      baseUrl + path,
      requestBody,
      { "content-type": "application/json", "content-length": String(Buffer.byteLength(requestBody)) },
      timeout
    );
    res.writeHead(result.status, {
      "content-type": result.contentType || "application/json; charset=utf-8",
      "access-control-allow-origin": "*"
    });
    res.end(result.body);
  }

  function findEngineForModel(modelId: string) {
    return listEngines().find(
      (e) => e.status === "running" &&
        (e.model_name === modelId || e.model_id === modelId)
    ) ?? null;
  }

  async function autoStartEngine(modelId: string) {
    let model = await getModel(modelsRoot, modelId);

    // Fallback: if no exact id match, find any model with matching capability
    // This handles frontend sending just "tts" / "asr" etc. as model name
    if (!model) {
      const allModels = await listModels(modelsRoot);
      const lowerId = modelId.toLowerCase();
      // Map engine-type keywords to capabilities
      const typeCaps: Record<string, string[]> = {
        tts: ["tts"], asr: ["asr"], vision: ["vision"], chat: ["chat"], embedding: ["embedding"], embeddings: ["embedding"], rerank: ["rerank"]
      };
      const targetCaps = typeCaps[lowerId];
      if (targetCaps) {
        model = allModels.find((m) =>
          m.status.download === "ready" &&
          m.capabilities.some((cap) => targetCaps.includes(cap))
        ) ?? allModels.find((m) =>
          m.capabilities.some((cap) => targetCaps.includes(cap))
        );
      }
      // Also try substring match on id or display_name
      if (!model) {
        model = allModels.find((m) =>
          m.id.includes(lowerId) || m.display_name.toLowerCase().includes(lowerId)
        );
      }
    }
    if (!model) return null;

    // Determine engine type from model capabilities
    let engineType: EngineType = "chat";
    if (model.capabilities.includes("vision")) engineType = "vision";
    else if (model.capabilities.includes("asr")) engineType = "asr";
    else if (model.capabilities.includes("tts")) engineType = "tts";
    else if (model.capabilities.includes("embedding")) engineType = "embedding";
    else if (model.capabilities.includes("rerank")) engineType = "rerank";

    const preset = enginePresets.find((p) => p.type === engineType);
    if (!preset) return null;

    try {
      const engine = await startEngine({
        type: engineType,
        model_id: model.id,
        model_name: model.display_name,
        model_path: model.local.path,
        port: preset.default_port,
        workspaceRoot,
        logsRoot
      });
      return engine;
    } catch {
      return null;
    }
  }

  return {
    proxyOpenAiRequest,
    autoStartEngine,
    findEngineForModel
  };
}

/* ── SSE stream proxy ─────────────────────────────── */
async function proxyStreamRaw(
  res: ServerResponse,
  targetUrl: string,
  rawBody: string
): Promise<void> {
  const upstream = await fetch(targetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody,
  });

  if (!upstream.ok || !upstream.body) {
    res.writeHead(upstream.status, { "Content-Type": "application/json" });
    res.end(await upstream.text().catch(() => ""));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
    res.end();
  }
}

function sendJsonProxy(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*"
  });
  res.end(JSON.stringify(payload));
}
