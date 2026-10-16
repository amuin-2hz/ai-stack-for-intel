/**
 * Author: zhenz
 * OpenAI-compatible proxy adapted for LocalRuntime.
 * Instead of proxying to Docker containers, requests go to Python inference
 * subprocesses managed by the engine manager.
 */

import type { ServerResponse } from "node:http";
import { createDeploymentHelpers } from "./deploymentHelpers.js";
import { startEngine, listEngines, enginePresets, type EngineType } from "./engineManager.js";
import { findModelByName, listModels, modelMatchesName, publishedModelNameFor } from "./modelRegistry.js";
import { proxyHttp, requestAudioWebSocket } from "./httpProxy.js";
import {
  createOpenAiErrorPayload,
  formatAudioTranscriptionPayload,
  normalizeChatCompletionBody,
  normalizeOpenAiErrorPayload,
  sanitizeOpenAiSuccessPayload
} from "./openaiProtocol.js";
import { createToolRuntime } from "./toolRuntime.js";

export interface OpenAIProxyDeps {
  modelsRoot: string;
  workspaceRoot: string;
  logsRoot: string;
  deploymentHelpers: ReturnType<typeof createDeploymentHelpers>;
}

export interface OpenAIProxyInternals {
  listEngines?: typeof listEngines;
  startEngine?: typeof startEngine;
  proxyHttp?: typeof proxyHttp;
  requestAudioWebSocket?: typeof requestAudioWebSocket;
  fetchImpl?: typeof fetch;
  toolRuntime?: Pick<ReturnType<typeof createToolRuntime>, "prepareToolOrchestration">;
}

export function createOpenAiProxy(deps: OpenAIProxyDeps, internals: OpenAIProxyInternals = {}) {
  const { modelsRoot, workspaceRoot, logsRoot } = deps;
  const toolRuntime = internals.toolRuntime ?? createToolRuntime({ modelsRoot, workspaceRoot, logsRoot });
  const listEnginesImpl = internals.listEngines ?? listEngines;
  const startEngineImpl = internals.startEngine ?? startEngine;
  const proxyHttpImpl = internals.proxyHttp ?? proxyHttp;
  const requestAudioWebSocketImpl = internals.requestAudioWebSocket ?? requestAudioWebSocket;
  const fetchImpl = internals.fetchImpl ?? fetch;

  async function proxyOpenAiRequest(
    res: ServerResponse,
    body: Record<string, unknown>,
    path: string,
    _rawBody?: string
  ): Promise<void> {
    const requestedModelName = String(body.model ?? "").trim();
    if (!requestedModelName) {
      sendJsonProxy(res, 400, createOpenAiErrorPayload("model is required.", {
        param: "model",
        code: "missing_required_parameter"
      }));
      return;
    }

    const resolvedModel = await findModelByName(modelsRoot, requestedModelName);
    const publicModelName = resolvedModel ? publishedModelNameFor(resolvedModel) : requestedModelName;
    const normalizedBody = path === "/chat/completions"
      ? {
          ...normalizeChatCompletionBody(body),
          model: publicModelName
        }
      : { ...body, model: publicModelName };

    // Find running engine that serves this model
    let engine = findEngineForModel(requestedModelName, resolvedModel?.id);

    // If no engine running, try to auto-start one
    if (!engine) {
      engine = await autoStartEngine(requestedModelName);
    }

    if (!engine || engine.status !== "running") {
      sendJsonProxy(res, 404, createOpenAiErrorPayload(`The model "${requestedModelName}" does not exist.`, {
        param: "model",
        code: "model_not_found"
      }));
      return;
    }

    const baseUrl = `http://127.0.0.1:${engine.port}/v1`;

    // Always rewrite the model field to the public model name exposed by the API.
    const requestBody = JSON.stringify(normalizedBody);

    // Pick a timeout appropriate for the endpoint:
    // TTS can take up to 2 min for very long text; ASR/chat are quicker.
    const timeout = path.includes("speech") ? 120_000
                  : path.includes("transcriptions") ? 30_000
                  : path.includes("embeddings") || path.includes("rerank") ? 60_000
                  : 60_000;

    if (path === "/chat/completions") {
      const orchestrationPlan = await toolRuntime.prepareToolOrchestration(normalizedBody, publicModelName);
      if (orchestrationPlan.handled && "status" in orchestrationPlan) {
        sendJsonProxy(res, orchestrationPlan.status, orchestrationPlan.payload);
        return;
      }
      if (orchestrationPlan.handled && orchestrationPlan.secondPassBody) {
        if (body.stream === true) {
          return proxyToolCallStream(
            res,
            baseUrl + path,
            orchestrationPlan.secondPassBody,
            orchestrationPlan.toolCalls,
            timeout,
            proxyHttpImpl
          );
        }
        const toolResponse = await proxyToolCallResponse(
          baseUrl + path,
          orchestrationPlan.secondPassBody,
          orchestrationPlan.toolCalls,
          timeout,
          proxyHttpImpl
        );
        res.writeHead(toolResponse.status, {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*"
        });
        res.end(JSON.stringify(toolResponse.payload));
        return;
      }
    }

    if (path === "/audio/transcriptions" || path === "/audio/speech") {
      const mode = path === "/audio/speech" ? "speech" : "transcription";
      const result = await requestAudioWebSocketImpl(
        `ws://127.0.0.1:${engine.port}/v1${path}`,
        normalizedBody,
        mode,
        timeout
      );
      // Decide the final status/headers/body before writing anything: writing
      // first and then failing (formatting, upstream shape) left the response
      // half-sent and made the outer catch write a second time.
      if (result.status >= 400 && (result.contentType || "").includes("application/json")) {
        const upstreamPayload = safeJsonParse(result.body.toString("utf-8"));
        sendJsonProxy(res, result.status, normalizeOpenAiErrorPayload(result.status, upstreamPayload, "Audio request failed."));
        return;
      }
      if (path === "/audio/transcriptions") {
        let formatted: { contentType: string; body: string };
        try {
          formatted = formatAudioTranscriptionPayload(
            safeJsonParse(result.body.toString("utf-8")),
            normalizedBody
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendJsonProxy(res, 502, createOpenAiErrorPayload(`Audio transcription response could not be normalized: ${message}`, { type: "server_error" }));
          return;
        }
        res.writeHead(result.status, {
          "content-type": formatted.contentType,
          "access-control-allow-origin": "*"
        });
        res.end(formatted.body);
        return;
      }
      res.writeHead(result.status, {
        "content-type": result.contentType || "application/json; charset=utf-8",
        "access-control-allow-origin": "*"
      });
      res.end(result.body);
      return;
    }

    // Stream SSE if requested by text-generation endpoints.
    if (body.stream === true) {
      return proxyStreamRaw(res, baseUrl + path, requestBody, fetchImpl);
    }

    const result = await proxyHttpImpl(
      "POST",
      baseUrl + path,
      requestBody,
      { "content-type": "application/json", "content-length": String(Buffer.byteLength(requestBody)) },
      timeout
    );
    const contentType = result.contentType || "application/json; charset=utf-8";
    if (contentType.includes("application/json")) {
      const upstreamPayload = safeJsonParse(result.body.toString("utf-8"));
      const responsePayload = result.status >= 400
        ? normalizeOpenAiErrorPayload(result.status, upstreamPayload, "Upstream request failed.")
        : sanitizeOpenAiSuccessPayload(path, upstreamPayload);
      res.writeHead(result.status, {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*"
      });
      res.end(JSON.stringify(responsePayload));
      return;
    }

    res.writeHead(result.status, {
      "content-type": contentType,
      "access-control-allow-origin": "*"
    });
    res.end(result.body);
  }

  function findEngineForModel(modelName: string, resolvedModelId?: string) {
    return listEnginesImpl().find(
      (e) => e.status === "running" &&
        (namesEqual(e.model_name, modelName)
          || namesEqual(e.model_id, modelName)
          || (resolvedModelId ? namesEqual(e.model_id, resolvedModelId) : false))
    ) ?? null;
  }

  async function autoStartEngine(modelName: string) {
    let model = await findModelByName(modelsRoot, modelName);

    // Fallback: if no exact id match, find any model with matching capability
    // This handles frontend sending just "tts" / "asr" etc. as model name
    if (!model) {
      const allModels = await listModels(modelsRoot);
      const lowerId = modelName.toLowerCase();
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
        model = allModels.find((m) => modelMatchesName(m, modelName))
          ?? allModels.find((m) =>
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
      const engine = await startEngineImpl({
        type: engineType,
        model_id: model.id,
        model_name: publishedModelNameFor(model),
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

/**
 * Execute the second-pass model call for a tool chain and return a final chat payload.
 */
async function proxyToolCallResponse(
  targetUrl: string,
  secondPassBody: Record<string, unknown>,
  toolCalls: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>,
  timeout: number,
  proxyHttpImpl: typeof proxyHttp
): Promise<{ status: number; payload: unknown }> {
  const result = await proxyJsonRequest(targetUrl, secondPassBody, timeout, proxyHttpImpl);
  if (result.status >= 400) {
    return {
      status: result.status,
      payload: normalizeOpenAiErrorPayload(result.status, result.payload, "Tool-assisted request failed.")
    };
  }

  const sanitizedPayload = sanitizeOpenAiSuccessPayload("/chat/completions", result.payload);
  return {
    status: result.status,
    payload: injectToolCallsIntoChatPayload(sanitizedPayload, toolCalls)
  };
}

/**
 * Execute a tool-assisted second pass and synthesize an OpenAI-style SSE stream.
 */
async function proxyToolCallStream(
  res: ServerResponse,
  targetUrl: string,
  secondPassBody: Record<string, unknown>,
  toolCalls: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>,
  timeout: number,
  proxyHttpImpl: typeof proxyHttp
): Promise<void> {
  const toolResponse = await proxyToolCallResponse(targetUrl, secondPassBody, toolCalls, timeout, proxyHttpImpl);
  if (toolResponse.status >= 400) {
    sendJsonProxy(res, toolResponse.status, toolResponse.payload);
    return;
  }

  const payload = toolResponse.payload as Record<string, unknown>;
  const model = readChatModel(payload) ?? String(secondPassBody.model ?? "unknown");
  const text = readChatContent(payload);
  const streamId = readChatId(payload) ?? `chatcmpl_${Date.now()}`;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });

  writeSseChunk(res, {
    id: streamId,
    object: "chat.completion.chunk",
    choices: [{ delta: { role: "assistant" }, index: 0 }],
    model
  });

  if (toolCalls.length) {
    const selectedTool = toolCalls[0];
    writeSseChunk(res, {
      id: streamId,
      object: "chat.completion.chunk",
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: selectedTool.id,
            type: "function",
            function: {
              name: selectedTool.function.name
            }
          }]
        },
        index: 0
      }],
      model
    });
    writeSseChunk(res, {
      id: streamId,
      object: "chat.completion.chunk",
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: {
              arguments: selectedTool.function.arguments
            }
          }]
        },
        index: 0
      }],
      model
    });
  }

  for (const chunk of splitTextForStream(text)) {
    writeSseChunk(res, {
      id: streamId,
      object: "chat.completion.chunk",
      choices: [{ delta: { content: chunk }, index: 0 }],
      model
    });
  }

  writeSseChunk(res, {
    id: streamId,
    object: "chat.completion.chunk",
    choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
    model
  });
  res.write("data: [DONE]\n\n");
  res.end();
}

/* ── SSE stream proxy ─────────────────────────────── */
async function proxyStreamRaw(
  res: ServerResponse,
  targetUrl: string,
  rawBody: string,
  fetchImpl: typeof fetch
): Promise<void> {
  const upstreamController = new AbortController();
  const abortUpstream = () => upstreamController.abort();
  res.once("close", abortUpstream);
  res.once("error", abortUpstream);

  const upstream = await fetchImpl(targetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody,
    signal: upstreamController.signal,
  });

  if (!upstream.ok || !upstream.body) {
    const upstreamBody = await upstream.text().catch(() => "");
    const upstreamPayload = safeJsonParse(upstreamBody);
    res.writeHead(upstream.status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(normalizeOpenAiErrorPayload(
      upstream.status,
      upstreamPayload,
      "Streaming request failed."
    )));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (res.destroyed || res.writableEnded) {
        upstreamController.abort();
        break;
      }
      res.write(decoder.decode(value, { stream: true }));
    }
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "AbortError") {
      throw error;
    }
  } finally {
    res.off("close", abortUpstream);
    res.off("error", abortUpstream);
    reader.releaseLock();
    if (!res.writableEnded) {
      res.end();
    }
  }
}

/**
 * Execute a JSON model request against the upstream inference server.
 */
async function proxyJsonRequest(
  targetUrl: string,
  body: Record<string, unknown>,
  timeout: number,
  proxyHttpImpl: typeof proxyHttp
): Promise<{ status: number; payload: unknown }> {
  const requestBody = JSON.stringify(body);
  const result = await proxyHttpImpl(
    "POST",
    targetUrl,
    requestBody,
    { "content-type": "application/json", "content-length": String(Buffer.byteLength(requestBody)) },
    timeout
  );
  return {
    status: result.status,
    payload: safeJsonParse(result.body.toString("utf-8"))
  };
}

/**
 * Inject executed tool calls into the final chat response message.
 */
function injectToolCallsIntoChatPayload(
  payload: unknown,
  toolCalls: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>
): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !toolCalls.length) {
    return payload;
  }
  const normalizedPayload = { ...(payload as Record<string, unknown>) };
  const choices = Array.isArray(normalizedPayload.choices) ? [...normalizedPayload.choices] : [];
  if (!choices.length) return normalizedPayload;

  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object" || Array.isArray(firstChoice)) {
    return normalizedPayload;
  }
  const message = (firstChoice as Record<string, unknown>).message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return normalizedPayload;
  }

  choices[0] = {
    ...(firstChoice as Record<string, unknown>),
    message: {
      ...(message as Record<string, unknown>),
      tool_calls: toolCalls
    }
  };
  normalizedPayload.choices = choices;
  return normalizedPayload;
}

/**
 * Read the final assistant content string from a chat completion payload.
 */
function readChatContent(payload: Record<string, unknown>): string {
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) return "";
  const message = (choice as Record<string, unknown>).message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return "";
  return typeof (message as Record<string, unknown>).content === "string"
    ? String((message as Record<string, unknown>).content)
    : "";
}

/**
 * Read the chat completion id from an upstream payload.
 */
function readChatId(payload: Record<string, unknown>): string | null {
  return typeof payload.id === "string" ? payload.id : null;
}

/**
 * Read the chat model name from an upstream payload.
 */
function readChatModel(payload: Record<string, unknown>): string | null {
  return typeof payload.model === "string" ? payload.model : null;
}

/**
 * Split text into modest SSE-sized chunks for synthetic streaming responses.
 */
function splitTextForStream(text: string, chunkSize = 16): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize));
  }
  return chunks;
}

/**
 * Write one JSON SSE chunk.
 */
function writeSseChunk(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendJsonProxy(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*"
  });
  res.end(JSON.stringify(payload));
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { message: value };
  }
}

function namesEqual(left: string, right: string): boolean {
  return normalizeName(left) === normalizeName(right);
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}
