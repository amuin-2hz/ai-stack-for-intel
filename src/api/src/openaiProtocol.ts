/**
 * Author: zhenz
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readRawBody, sendJson } from "./serverUtils.js";
import { validateToolingRequest } from "./toolValidator.js";

export interface OpenAiErrorOptions {
  type?: string;
  param?: string | null;
  code?: string | null;
}

export interface ParsedOpenAiBody {
  body: Record<string, unknown>;
  rawBody: string;
}

export interface ChatResponseFormatSpec {
  type: "text" | "json_object" | "json_schema";
  jsonSchema?: Record<string, unknown> | null;
}

export type OpenAiValidationResult = {
  ok: true;
} | {
  ok: false;
  status: number;
  message: string;
  options?: OpenAiErrorOptions;
};

/**
 * Build an OpenAI-compatible error response body.
 */
export function createOpenAiErrorPayload(
  message: string,
  options: OpenAiErrorOptions = {}
): { error: { message: string; type: string; param: string | null; code: string | null } } {
  return {
    error: {
      message,
      type: options.type ?? "invalid_request_error",
      param: options.param ?? null,
      code: options.code ?? null
    }
  };
}

/**
 * Send a normalized OpenAI-compatible error response.
 */
export function sendOpenAiError(
  res: ServerResponse,
  status: number,
  message: string,
  options: OpenAiErrorOptions = {}
): void {
  sendJson(res, status, createOpenAiErrorPayload(message, {
    type: options.type ?? defaultErrorTypeForStatus(status),
    param: options.param,
    code: options.code
  }));
}

/**
 * Parse a JSON body and convert malformed payloads into OpenAI errors.
 */
export async function parseOpenAiJsonBody(
  req: IncomingMessage,
  res: ServerResponse
): Promise<ParsedOpenAiBody | null> {
  const rawBody = await readRawBody(req);
  if (!rawBody.trim()) {
    return { body: {}, rawBody };
  }

  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      sendOpenAiError(res, 400, "Request body must be a JSON object.", {
        code: "invalid_json"
      });
      return null;
    }
    return { body: parsed as Record<string, unknown>, rawBody };
  } catch {
    sendOpenAiError(res, 400, "Invalid JSON body.", {
      code: "invalid_json"
    });
    return null;
  }
}

/**
 * Normalize heterogeneous upstream failures into the OpenAI error shape.
 */
export function normalizeOpenAiErrorPayload(
  status: number,
  payload: unknown,
  fallbackMessage: string,
  options: OpenAiErrorOptions = {}
): { error: { message: string; type: string; param: string | null; code: string | null } } {
  const nestedError = payload && typeof payload === "object" && "error" in payload
    ? (payload as { error?: unknown }).error
    : undefined;
  const source = nestedError && typeof nestedError === "object" ? nestedError : payload;
  const message = readStringField(source, "message")
    ?? readStringField(source, "detail")
    ?? readStringField(payload, "detail")
    ?? fallbackMessage;
  const type = readStringField(source, "type") ?? options.type ?? defaultErrorTypeForStatus(status);
  const param = readNullableStringField(source, "param") ?? options.param ?? null;
  const code = readNullableStringField(source, "code") ?? options.code ?? null;
  return createOpenAiErrorPayload(message, { type, param, code });
}

/**
 * Remove custom fields that should not leak from upstream inference services.
 */
export function sanitizeOpenAiSuccessPayload(path: string, payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const normalizedPayload = { ...(payload as Record<string, unknown>) };
  if (path === "/chat/completions") {
    delete normalizedPayload.chunks;
  }
  if (path === "/embeddings") {
    delete normalizedPayload.time;
  }
  return normalizedPayload;
}

/**
 * Validate chat completion requests against the supported OpenAI field contract.
 */
export function validateChatCompletionBody(body: Record<string, unknown>): OpenAiValidationResult {
  if (!body.model) {
    return invalidParam("model", "model is required.", "missing_required_parameter");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return invalidParam("messages", "messages must be a non-empty array.", "invalid_messages");
  }
  const responseFormat = parseChatResponseFormat(body.response_format);
  if (!responseFormat.valid) {
    return invalidParam("response_format", responseFormat.message, "unsupported_response_format");
  }
  const toolValidation = validateToolingRequest(body);
  if (!toolValidation.ok) {
    return invalidParam(toolValidation.param, toolValidation.message, toolValidation.code);
  }
  return { ok: true };
}

/**
 * Normalize chat completion requests into the subset currently supported by the runtime.
 */
export function normalizeChatCompletionBody(body: Record<string, unknown>): Record<string, unknown> {
  const responseFormat = parseChatResponseFormat(body.response_format);
  if (!responseFormat.valid || responseFormat.spec.type === "text") {
    return body;
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const systemInstruction = buildResponseFormatInstruction(responseFormat.spec);
  return {
    ...body,
    messages: prependSystemInstruction(messages, systemInstruction)
  };
}

/**
 * Validate embedding requests against the supported OpenAI field contract.
 */
export function validateEmbeddingsBody(body: Record<string, unknown>): OpenAiValidationResult {
  if (!body.model) {
    return invalidParam("model", "model is required.", "missing_required_parameter");
  }
  if (body.input === undefined || body.input === null || body.input === "") {
    return invalidParam("input", "input is required.", "missing_required_parameter");
  }
  return { ok: true };
}

/**
 * Validate audio transcription requests and their compatible response formats.
 */
export function validateAudioTranscriptionBody(body: Record<string, unknown>): OpenAiValidationResult {
  if (!body.model) {
    return invalidParam("model", "model is required.", "missing_required_parameter");
  }
  const responseFormat = body.response_format;
  if (responseFormat !== undefined && !["json", "text", "verbose_json"].includes(String(responseFormat))) {
    return invalidParam(
      "response_format",
      "response_format must be one of: json, text, verbose_json.",
      "unsupported_response_format"
    );
  }
  return { ok: true };
}

/**
 * Validate audio speech requests and their supported output formats.
 */
export function validateAudioSpeechBody(body: Record<string, unknown>): OpenAiValidationResult {
  if (!body.model) {
    return invalidParam("model", "model is required.", "missing_required_parameter");
  }
  if (body.input === undefined || body.input === null || body.input === "") {
    return invalidParam("input", "input is required.", "missing_required_parameter");
  }
  const responseFormat = String(body.response_format ?? "wav");
  if (!["wav"].includes(responseFormat)) {
    return invalidParam(
      "response_format",
      "Only wav response_format is currently supported.",
      "unsupported_response_format"
    );
  }
  return { ok: true };
}

/**
 * Convert transcription results into the requested OpenAI-compatible response format.
 */
export function formatAudioTranscriptionPayload(
  payload: unknown,
  body: Record<string, unknown>
): { contentType: string; body: string } {
  const normalizedPayload = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const text = readStringField(normalizedPayload, "text") ?? "";
  const responseFormat = String(body.response_format ?? "json");

  if (responseFormat === "text") {
    return {
      contentType: "text/plain; charset=utf-8",
      body: text
    };
  }

  if (responseFormat === "verbose_json") {
    return {
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        text,
        language: typeof body.language === "string" ? body.language : null,
        duration: null,
        segments: []
      })
    };
  }

  return {
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify({ text })
  };
}

/**
 * Derive the closest OpenAI error type from an HTTP status code.
 */
function defaultErrorTypeForStatus(status: number): string {
  if (status >= 500) return "server_error";
  if (status === 401) return "authentication_error";
  if (status === 429) return "rate_limit_error";
  return "invalid_request_error";
}

/**
 * Create a reusable invalid-parameter validation result.
 */
function invalidParam(param: string, message: string, code: string): OpenAiValidationResult {
  return {
    ok: false,
    status: 400,
    message,
    options: {
      param,
      code
    }
  };
}

/**
 * Parse the chat response_format field into a supported internal representation.
 */
function parseChatResponseFormat(
  value: unknown
): { valid: true; spec: ChatResponseFormatSpec } | { valid: false; message: string } {
  if (value === undefined || value === null) {
    return { valid: true, spec: { type: "text" } };
  }
  if (typeof value === "string") {
    if (value === "text" || value === "json_object") {
      return { valid: true, spec: { type: value } };
    }
    return { valid: false, message: "response_format must be text, json_object, or a supported object form." };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, message: "response_format must be an object with a supported type." };
  }

  const type = typeof (value as Record<string, unknown>).type === "string"
    ? String((value as Record<string, unknown>).type)
    : "";
  if (type === "text" || type === "json_object") {
    return { valid: true, spec: { type } };
  }
  if (type === "json_schema") {
    const jsonSchema = (value as Record<string, unknown>).json_schema;
    if (!jsonSchema || typeof jsonSchema !== "object" || Array.isArray(jsonSchema)) {
      return { valid: false, message: "response_format.type=json_schema requires a json_schema object." };
    }
    return {
      valid: true,
      spec: {
        type,
        jsonSchema: jsonSchema as Record<string, unknown>
      }
    };
  }

  return { valid: false, message: "response_format.type must be one of: text, json_object, json_schema." };
}

/**
 * Build a soft instruction so current models can approximate OpenAI structured output behavior.
 */
function buildResponseFormatInstruction(spec: ChatResponseFormatSpec): string {
  if (spec.type === "json_object") {
    return "Return only a valid JSON object. Do not include markdown fences or extra commentary.";
  }
  return `Return only JSON that matches this schema. Do not include markdown fences or extra commentary.\nSchema:\n${JSON.stringify(spec.jsonSchema ?? {}, null, 2)}`;
}

/**
 * Prepend a system instruction while preserving existing message order.
 */
function prependSystemInstruction(messages: unknown[], instruction: string): unknown[] {
  const normalizedMessages = [...messages];
  const firstMessage = normalizedMessages[0];
  if (firstMessage && typeof firstMessage === "object" && !Array.isArray(firstMessage)) {
    const firstRole = (firstMessage as Record<string, unknown>).role;
    const firstContent = (firstMessage as Record<string, unknown>).content;
    if (firstRole === "system" && typeof firstContent === "string") {
      normalizedMessages[0] = {
        ...(firstMessage as Record<string, unknown>),
        content: `${instruction}\n\n${firstContent}`
      };
      return normalizedMessages;
    }
  }
  return [
    { role: "system", content: instruction },
    ...normalizedMessages
  ];
}

/**
 * Read a string field from a plain object-like value.
 */
function readStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim() ? field : undefined;
}

/**
 * Read a nullable string field from a plain object-like value.
 */
function readNullableStringField(value: unknown, key: string): string | null | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  if (field === null) return null;
  return typeof field === "string" && field.trim() ? field : undefined;
}
