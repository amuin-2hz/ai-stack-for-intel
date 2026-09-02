/**
 * Author: zhenz
 */

export interface OpenAiFunctionParameters {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  enum?: unknown[];
}

export interface OpenAiFunctionToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: OpenAiFunctionParameters;
  };
}

export interface OpenAiNamedToolChoice {
  type: "function";
  function: {
    name: string;
  };
}

export type OpenAiToolChoice = "none" | "auto" | "required" | OpenAiNamedToolChoice;

export interface ParsedToolChoice {
  mode: "none" | "auto" | "required" | "named";
  name?: string;
}

export interface SupportedToolSpec {
  name: string;
  description: string;
  parameters: OpenAiFunctionParameters;
  keywords: string[];
}

export const supportedToolSpecs: SupportedToolSpec[] = [
  {
    name: "getRuntimeStatus",
    description: "Get the current local runtime status, device availability, and system health.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    },
    keywords: ["runtime", "status", "health", "device", "环境", "状态", "设备", "健康"]
  },
  {
    name: "listLocalModels",
    description: "List local models that are available in the runtime registry.",
    parameters: {
      type: "object",
      properties: {
        capability: {
          type: "string",
          enum: ["chat", "vision", "asr", "tts", "embedding", "rerank"]
        }
      },
      required: []
    },
    keywords: ["model", "models", "list", "local", "模型", "列出", "本地"]
  },
  {
    name: "getEngineStatus",
    description: "Inspect running inference engine processes and their health status.",
    parameters: {
      type: "object",
      properties: {
        engineType: {
          type: "string",
          enum: ["chat", "vision", "asr", "tts", "embedding", "rerank"]
        }
      },
      required: []
    },
    keywords: ["engine", "engines", "process", "port", "引擎", "进程", "端口"]
  },
  {
    name: "transcribeLocalAudio",
    description: "Transcribe a local audio file with the ASR engine.",
    parameters: {
      type: "object",
      properties: {
        audioPath: {
          type: "string"
        },
        language: {
          type: "string",
          enum: ["zh", "en", "ja", "auto"]
        }
      },
      required: ["audioPath"]
    },
    keywords: ["audio", "transcribe", "speech", "asr", "wav", "mp3", "m4a", "音频", "转写", "语音"]
  }
];

/**
 * Return the built-in tool specification by name.
 */
export function supportedToolByName(name: string): SupportedToolSpec | undefined {
  return supportedToolSpecs.find((tool) => tool.name === name);
}

/**
 * Normalize tool_choice into a simpler internal shape.
 */
export function normalizeToolChoice(value: unknown): ParsedToolChoice {
  if (value === undefined || value === null || value === "auto") {
    return { mode: "auto" };
  }
  if (value === "none" || value === "required") {
    return { mode: value };
  }
  if (
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as Record<string, unknown>).type === "function"
  ) {
    const functionValue = (value as Record<string, unknown>).function;
    if (functionValue && typeof functionValue === "object" && typeof (functionValue as Record<string, unknown>).name === "string") {
      return {
        mode: "named",
        name: String((functionValue as Record<string, unknown>).name)
      };
    }
  }
  return { mode: "auto" };
}

/**
 * Extract the user-facing function name from a tool definition.
 */
export function toolNameOf(tool: OpenAiFunctionToolDefinition): string {
  return tool.function.name;
}
