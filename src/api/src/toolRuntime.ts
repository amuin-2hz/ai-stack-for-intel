/**
 * Author: zhenz
 */

import { randomUUID } from "node:crypto";
import { createToolExecutor, type ToolExecutorDeps } from "./toolExecutor.js";
import type {
  OpenAiFunctionParameters,
  OpenAiFunctionToolDefinition,
  ParsedToolChoice
} from "./toolSchema.js";
import {
  normalizeToolChoice,
  supportedToolByName,
  toolNameOf
} from "./toolSchema.js";
import {
  parseToolArguments,
  validateToolArguments,
  validateToolChoice,
  validateToolDefinitions
} from "./toolValidator.js";

export interface ToolRuntimeDeps extends ToolExecutorDeps {}
export interface ToolRuntimeInternals {
  executor?: Pick<ReturnType<typeof createToolExecutor>, "executeTool">;
}

export interface ToolOrchestrationPlan {
  handled: boolean;
  toolCalls: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  secondPassBody?: Record<string, unknown>;
}

export interface ToolOrchestrationError {
  handled: true;
  status: number;
  payload: unknown;
}

/**
 * Create the service-side tool orchestration runtime used by chat completions.
 */
export function createToolRuntime(deps: ToolRuntimeDeps, internals: ToolRuntimeInternals = {}) {
  const executor = internals.executor ?? createToolExecutor(deps);

  /**
   * Decide whether a request should execute a built-in tool, and prepare a second-pass model call.
   */
  async function prepareToolOrchestration(
    body: Record<string, unknown>,
    publicModelName: string
  ): Promise<ToolOrchestrationPlan | ToolOrchestrationError> {
    const toolValidation = validateToolDefinitions(body.tools);
    if (!toolValidation.ok) {
      return buildError(toolValidation.message, toolValidation.param, toolValidation.code);
    }

    const tools = toolValidation.tools;
    if (!tools.length) return { handled: false, toolCalls: [] };

    const toolChoiceValidation = validateToolChoice(body.tool_choice, tools);
    if (!toolChoiceValidation.ok) {
      return buildError(toolChoiceValidation.message, toolChoiceValidation.param, toolChoiceValidation.code);
    }

    const selectedTool = selectToolInvocation(tools, normalizeToolChoice(body.tool_choice), body);
    if (!selectedTool) {
      return { handled: false, toolCalls: [] };
    }

    const argumentValidation = validateToolArguments(selectedTool.parameters, selectedTool.args);
    if (!argumentValidation.ok) {
      return buildError(argumentValidation.message, argumentValidation.param, argumentValidation.code);
    }

    const executionResult = await executor.executeTool(selectedTool.name, selectedTool.args);
    const toolCallId = `call_${randomUUID().replace(/-/g, "")}`;
    const toolCalls = [{
      id: toolCallId,
      type: "function" as const,
      function: {
        name: selectedTool.name,
        arguments: JSON.stringify(selectedTool.args)
      }
    }];

    const originalMessages = Array.isArray(body.messages) ? body.messages : [];
    const secondPassMessages = [
      ...originalMessages,
      {
        role: "assistant",
        content: null,
        tool_calls: toolCalls
      },
      {
        role: "tool",
        tool_call_id: toolCallId,
        content: JSON.stringify(executionResult.content)
      }
    ];

    return {
      handled: true,
      toolCalls,
      secondPassBody: {
        ...body,
        model: publicModelName,
        stream: false,
        messages: secondPassMessages,
        tool_choice: "none",
        parallel_tool_calls: false
      }
    };
  }

  return {
    prepareToolOrchestration
  };
}

interface SelectedToolInvocation {
  name: string;
  parameters?: OpenAiFunctionParameters;
  args: Record<string, unknown>;
}

/**
 * Pick one built-in tool invocation using explicit choice first, then a conservative auto heuristic.
 */
function selectToolInvocation(
  tools: OpenAiFunctionToolDefinition[],
  toolChoice: ParsedToolChoice,
  body: Record<string, unknown>
): SelectedToolInvocation | null {
  if (toolChoice.mode === "none") return null;

  const latestUserText = extractLatestUserText(body.messages);
  const selectedDefinition = toolChoice.mode === "named"
    ? tools.find((tool) => toolNameOf(tool) === toolChoice.name)
    : selectAutoTool(tools, latestUserText, toolChoice.mode === "required");

  if (!selectedDefinition) return null;
  const toolName = toolNameOf(selectedDefinition);
  const inferredArguments = inferToolArguments(toolName, latestUserText);
  return {
    name: toolName,
    parameters: selectedDefinition.function.parameters,
    args: inferredArguments
  };
}

/**
 * Select one tool from the available list using supported keywords and fallback order.
 */
function selectAutoTool(
  tools: OpenAiFunctionToolDefinition[],
  latestUserText: string,
  required: boolean
): OpenAiFunctionToolDefinition | undefined {
  const rankedCandidates = tools
    .map((tool, index) => ({
      tool,
      index,
      score: scoreToolSelection(tool, latestUserText)
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  return rankedCandidates[0]?.tool ?? (required ? tools[0] : undefined);
}

/**
 * Infer basic tool arguments from the latest user text for the supported built-in tools.
 */
function inferToolArguments(toolName: string, latestUserText: string): Record<string, unknown> {
  switch (toolName) {
    case "getEngineStatus":
      return inferEngineStatusArguments(latestUserText);
    case "listLocalModels":
      return inferListModelsArguments(latestUserText);
    case "transcribeLocalAudio":
      return inferTranscribeArguments(latestUserText);
    default:
      return {};
  }
}

/**
 * Extract the latest user message text for tool selection and argument inference.
 */
function extractLatestUserText(messagesValue: unknown): string {
  if (!Array.isArray(messagesValue)) return "";
  for (let index = messagesValue.length - 1; index >= 0; index -= 1) {
    const message = messagesValue[index];
    if (!message || typeof message !== "object" || Array.isArray(message)) continue;
    if ((message as Record<string, unknown>).role !== "user") continue;
    const content = (message as Record<string, unknown>).content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((part) => part && typeof part === "object" && (part as Record<string, unknown>).type === "text")
        .map((part) => String((part as Record<string, unknown>).text ?? ""))
        .join(" ");
    }
  }
  return "";
}

/**
 * Infer engine status arguments from text keywords.
 */
function inferEngineStatusArguments(text: string): Record<string, unknown> {
  const engineType = inferCapabilityFromText(text);
  return engineType ? { engineType } : {};
}

/**
 * Infer a capability filter for listLocalModels.
 */
function inferListModelsArguments(text: string): Record<string, unknown> {
  const engineStatusArgs = inferEngineStatusArguments(text);
  return engineStatusArgs.engineType ? { capability: engineStatusArgs.engineType } : {};
}

/**
 * Infer local audio transcription arguments from a user message.
 */
function inferTranscribeArguments(text: string): Record<string, unknown> {
  const audioPath = extractAudioPath(text);
  const args: Record<string, unknown> = {};
  if (audioPath) {
    args.audioPath = audioPath;
  }
  if (/english|\ben\b/i.test(text)) {
    args.language = "en";
  } else if (/japanese|\bja\b|日语/i.test(text)) {
    args.language = "ja";
  } else if (/中文|chinese|\bzh\b/i.test(text)) {
    args.language = "zh";
  } else {
    args.language = "auto";
  }
  return args;
}

/**
 * Create a normalized OpenAI-style error object for tool orchestration failures.
 */
function buildError(message: string, param: string, code: string): ToolOrchestrationError {
  return {
    handled: true,
    status: 400,
    payload: {
      error: {
        message,
        type: "invalid_request_error",
        param,
        code
      }
    }
  };
}

/**
 * Score one supported tool against the latest user text using keyword and argument evidence.
 */
function scoreToolSelection(
  tool: OpenAiFunctionToolDefinition,
  latestUserText: string
): number {
  const toolName = toolNameOf(tool);
  const spec = supportedToolByName(toolName);
  if (!spec) return 0;

  const normalizedText = latestUserText.toLowerCase();
  const inferredArguments = inferToolArguments(toolName, latestUserText);
  let score = 0;

  for (const keyword of spec.keywords) {
    if (normalizedText.includes(keyword.toLowerCase())) {
      score += 3;
    }
  }

  const requiredKeys = spec.parameters.required ?? [];
  const satisfiedRequiredCount = requiredKeys.filter((key) => hasMeaningfulArgument(inferredArguments[key])).length;
  score += satisfiedRequiredCount * 8;
  if (Object.keys(inferredArguments).some((key) => hasMeaningfulArgument(inferredArguments[key]))) {
    score += 2;
  }

  switch (toolName) {
    case "transcribeLocalAudio":
      if (typeof inferredArguments.audioPath === "string") score += 12;
      if (/\b(transcribe|transcription|subtitle|captions?)\b|转写|识别|听写/i.test(latestUserText)) score += 6;
      break;
    case "listLocalModels":
      if (/\b(list|show|available)\b.*\bmodels?\b|\bmodels?\b.*\b(list|show|available)\b|列出.*模型|有哪些模型|可用模型/i.test(latestUserText)) {
        score += 6;
      }
      if (typeof inferredArguments.capability === "string") score += 4;
      break;
    case "getEngineStatus":
      if (/\b(engine|engines|process|processes|port|ports)\b|引擎|进程|端口/i.test(latestUserText)) {
        score += 6;
      }
      if (typeof inferredArguments.engineType === "string") score += 4;
      break;
    case "getRuntimeStatus":
      if (/\b(runtime|status|health|device|devices)\b|运行时|状态|健康|设备/i.test(latestUserText)) {
        score += 6;
      }
      break;
    default:
      break;
  }

  return score;
}

/**
 * Detect a capability or engine type from free-form user text.
 */
function inferCapabilityFromText(text: string): string | undefined {
  const mapping: Array<{ engineType: string; keywords: string[] }> = [
    { engineType: "vision", keywords: ["vision", "vlm", "image", "images", "图像", "图片", "视觉"] },
    { engineType: "tts", keywords: ["tts", "text to speech", "speak", "voice", "朗读", "语音合成"] },
    { engineType: "asr", keywords: ["asr", "transcribe", "transcription", "speech", "audio", "音频", "语音", "转写", "识别"] },
    { engineType: "embedding", keywords: ["embedding", "embeddings", "embed", "向量"] },
    { engineType: "rerank", keywords: ["rerank", "reranker", "排序", "重排"] },
    { engineType: "chat", keywords: ["chat", "llm", "对话", "聊天", "文本"] }
  ];
  const normalizedText = text.toLowerCase();
  const matched = mapping.find((entry) => entry.keywords.some((keyword) => normalizedText.includes(keyword.toLowerCase())));
  return matched?.engineType;
}

/**
 * Extract a local audio path from plain text, including quoted paths that contain spaces.
 */
function extractAudioPath(text: string): string | undefined {
  const quotedMatch = text.match(/["'`]((?:\/|\.\/)[^"'`]+\.(wav|mp3|m4a|flac|ogg|webm))["'`]/i);
  if (quotedMatch) {
    return quotedMatch[1];
  }
  const plainMatch = text.match(/(?:\/|\.\/)[^\s"'`]+\.(wav|mp3|m4a|flac|ogg|webm)/i);
  return plainMatch?.[0];
}

/**
 * Check whether an inferred argument should count as present during tool scoring.
 */
function hasMeaningfulArgument(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0 && value !== "auto";
  }
  return value !== undefined && value !== null;
}

/**
 * Parse arbitrary JSON text safely.
 */
export function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { message: value };
  }
}
