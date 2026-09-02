/**
 * Author: zhenz
 */

import type { OpenAiFunctionParameters, OpenAiFunctionToolDefinition } from "./toolSchema.js";
import { normalizeToolChoice, supportedToolByName, toolNameOf } from "./toolSchema.js";

export type ToolValidationResult = {
  ok: true;
} | {
  ok: false;
  message: string;
  param: string;
  code: string;
};

export type ParsedToolDefinitionsResult = {
  ok: true;
  tools: OpenAiFunctionToolDefinition[];
} | {
  ok: false;
  message: string;
  param: string;
  code: string;
};

/**
 * Validate tools, tool_choice, and parallel_tool_calls for chat completions.
 */
export function validateToolingRequest(body: Record<string, unknown>): ToolValidationResult {
  if (body.parallel_tool_calls !== undefined && typeof body.parallel_tool_calls !== "boolean") {
    return invalidTooling("parallel_tool_calls", "parallel_tool_calls must be a boolean.", "invalid_parallel_tool_calls");
  }
  if (body.parallel_tool_calls === true) {
    return invalidTooling(
      "parallel_tool_calls",
      "parallel_tool_calls=true is not supported yet.",
      "unsupported_parallel_tool_calls"
    );
  }

  const toolsResult = validateToolDefinitions(body.tools);
  if (!toolsResult.ok) return toolsResult;

  const toolChoiceResult = validateToolChoice(body.tool_choice, toolsResult.tools);
  if (!toolChoiceResult.ok) return toolChoiceResult;

  return { ok: true };
}

/**
 * Validate an array of OpenAI function tools and return the parsed subset.
 */
export function validateToolDefinitions(
  value: unknown
): ParsedToolDefinitionsResult {
  if (value === undefined || value === null) {
    return { ok: true, tools: [] };
  }
  if (!Array.isArray(value)) {
    return invalidParsedTools("tools", "tools must be an array.", "invalid_tools");
  }

  const parsedTools: OpenAiFunctionToolDefinition[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return invalidParsedTools("tools", "Each tool must be an object.", "invalid_tools");
    }
    if ((entry as Record<string, unknown>).type !== "function") {
      return invalidParsedTools("tools", "Only function tools are currently supported.", "unsupported_tool_type");
    }
    const functionValue = (entry as Record<string, unknown>).function;
    if (!functionValue || typeof functionValue !== "object" || Array.isArray(functionValue)) {
      return invalidParsedTools("tools", "Each function tool must include a function object.", "invalid_tools");
    }
    const name = (functionValue as Record<string, unknown>).name;
    if (typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
      return invalidParsedTools("tools", "Tool function.name must be a valid identifier.", "invalid_tool_name");
    }
    const builtIn = supportedToolByName(name);
    if (!builtIn) {
      return invalidParsedTools("tools", `Unsupported tool "${name}".`, "unsupported_tool");
    }
    const parameters = (functionValue as Record<string, unknown>).parameters;
    if (parameters !== undefined) {
      const parameterValidation = validateSchemaSubset(parameters);
      if (!parameterValidation.ok) {
        return invalidParsedTools("tools", parameterValidation.message, parameterValidation.code);
      }
    }
    parsedTools.push(entry as OpenAiFunctionToolDefinition);
  }

  return { ok: true, tools: parsedTools };
}

/**
 * Validate the requested tool_choice against the available tool names.
 */
export function validateToolChoice(
  value: unknown,
  tools: OpenAiFunctionToolDefinition[]
): ToolValidationResult {
  if (value === undefined || value === null) return { ok: true };
  if (value === "none" || value === "auto" || value === "required") return { ok: true };

  const parsed = normalizeToolChoice(value);
  if (parsed.mode !== "named" || !parsed.name) {
    return invalidTooling(
      "tool_choice",
      "tool_choice must be none, auto, required, or a function selector object.",
      "invalid_tool_choice"
    );
  }

  if (!tools.some((tool) => toolNameOf(tool) === parsed.name)) {
    return invalidTooling(
      "tool_choice",
      `tool_choice references unknown tool "${parsed.name}".`,
      "unknown_tool_choice"
    );
  }

  return { ok: true };
}

/**
 * Validate tool arguments against a small JSON Schema subset.
 */
export function validateToolArguments(
  parameters: OpenAiFunctionParameters | undefined,
  args: Record<string, unknown>
): ToolValidationResult {
  const schema = parameters ?? { type: "object", properties: {}, required: [] };
  if (schema.type && schema.type !== "object") {
    return invalidTooling("tools", "Tool parameter schema root type must be object.", "invalid_tool_schema");
  }

  const properties = schema.properties ?? {};
  const required = schema.required ?? [];
  for (const field of required) {
    if (!(field in args)) {
      return invalidTooling("arguments", `Missing required tool argument "${field}".`, "missing_tool_argument");
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const propertySchema = properties[key];
    if (!propertySchema || typeof propertySchema !== "object" || Array.isArray(propertySchema)) {
      continue;
    }
    const expectedType = (propertySchema as Record<string, unknown>).type;
    if (expectedType === "string" && typeof value !== "string") {
      return invalidTooling("arguments", `Tool argument "${key}" must be a string.`, "invalid_tool_argument");
    }
    if (expectedType === "number" && typeof value !== "number") {
      return invalidTooling("arguments", `Tool argument "${key}" must be a number.`, "invalid_tool_argument");
    }
    if (expectedType === "boolean" && typeof value !== "boolean") {
      return invalidTooling("arguments", `Tool argument "${key}" must be a boolean.`, "invalid_tool_argument");
    }
    const allowedEnum = (propertySchema as Record<string, unknown>).enum;
    if (Array.isArray(allowedEnum) && !allowedEnum.includes(value)) {
      return invalidTooling(
        "arguments",
        `Tool argument "${key}" must be one of: ${allowedEnum.join(", ")}.`,
        "invalid_tool_argument"
      );
    }
  }

  return { ok: true };
}

/**
 * Parse a tool argument string into a JSON object.
 */
export function parseToolArguments(value: string): ({ ok: true; args: Record<string, unknown> } | ToolValidationResult) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return invalidTooling("arguments", "Tool arguments must decode to a JSON object.", "invalid_tool_arguments_json");
    }
    return { ok: true, args: parsed as Record<string, unknown> };
  } catch {
    return invalidTooling("arguments", "Tool arguments must be valid JSON.", "invalid_tool_arguments_json");
  }
}

/**
 * Validate the supported JSON Schema subset used for tool parameters.
 */
function validateSchemaSubset(value: unknown): ToolValidationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalidTooling("tools", "Tool parameters must be a JSON Schema object.", "invalid_tool_schema");
  }
  const schema = value as Record<string, unknown>;
  if (schema.type !== undefined && schema.type !== "object") {
    return invalidTooling("tools", "Only object tool parameter schemas are supported.", "invalid_tool_schema");
  }
  if (schema.properties !== undefined && (typeof schema.properties !== "object" || Array.isArray(schema.properties))) {
    return invalidTooling("tools", "Tool parameter properties must be an object.", "invalid_tool_schema");
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required) || !schema.required.every((entry) => typeof entry === "string"))) {
    return invalidTooling("tools", "Tool parameter required must be a string array.", "invalid_tool_schema");
  }
  return { ok: true };
}

/**
 * Build a consistent validation failure payload for tooling inputs.
 */
function invalidTooling(param: string, message: string, code: string): ToolValidationResult {
  return {
    ok: false,
    message,
    param,
    code
  };
}

/**
 * Build a parsed-tool failure shape that preserves the collected-tool return type.
 */
function invalidParsedTools(param: string, message: string, code: string): ParsedToolDefinitionsResult {
  return {
    ok: false,
    message,
    param,
    code
  };
}
