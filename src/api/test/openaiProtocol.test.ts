/**
 * Author: zhenz
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatAudioTranscriptionPayload,
  normalizeChatCompletionBody,
  sanitizeOpenAiSuccessPayload,
  validateAudioSpeechBody,
  validateAudioTranscriptionBody,
  validateChatCompletionBody,
  validateEmbeddingsBody
} from "../src/openaiProtocol.js";

test("validateChatCompletionBody rejects missing messages", () => {
  const result = validateChatCompletionBody({ model: "demo-model" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.options?.param, "messages");
    assert.equal(result.options?.code, "invalid_messages");
  }
});

test("validateEmbeddingsBody rejects missing input", () => {
  const result = validateEmbeddingsBody({ model: "demo-model" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.options?.param, "input");
    assert.equal(result.options?.code, "missing_required_parameter");
  }
});

test("validateAudioTranscriptionBody rejects unsupported response_format", () => {
  const result = validateAudioTranscriptionBody({
    model: "demo-model",
    response_format: "srt"
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.options?.param, "response_format");
    assert.equal(result.options?.code, "unsupported_response_format");
  }
});

test("validateAudioSpeechBody rejects unsupported response_format", () => {
  const result = validateAudioSpeechBody({
    model: "demo-model",
    input: "hello",
    response_format: "mp3"
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.options?.param, "response_format");
    assert.equal(result.options?.code, "unsupported_response_format");
  }
});

test("formatAudioTranscriptionPayload supports text, json, and verbose_json", () => {
  const basePayload = { text: "hello world" };

  const textResult = formatAudioTranscriptionPayload(basePayload, {
    model: "demo-model",
    response_format: "text"
  });
  assert.equal(textResult.contentType, "text/plain; charset=utf-8");
  assert.equal(textResult.body, "hello world");

  const jsonResult = formatAudioTranscriptionPayload(basePayload, {
    model: "demo-model",
    response_format: "json"
  });
  assert.deepEqual(JSON.parse(jsonResult.body), { text: "hello world" });

  const verboseResult = formatAudioTranscriptionPayload(basePayload, {
    model: "demo-model",
    language: "zh",
    response_format: "verbose_json"
  });
  assert.deepEqual(JSON.parse(verboseResult.body), {
    text: "hello world",
    language: "zh",
    duration: null,
    segments: []
  });
});

test("sanitizeOpenAiSuccessPayload removes non-standard fields", () => {
  assert.deepEqual(
    sanitizeOpenAiSuccessPayload("/chat/completions", {
      id: "chatcmpl-1",
      chunks: ["a", "b"]
    }),
    { id: "chatcmpl-1" }
  );
  assert.deepEqual(
    sanitizeOpenAiSuccessPayload("/embeddings", {
      object: "list",
      time: 1.23
    }),
    { object: "list" }
  );
});

test("validateChatCompletionBody accepts supported response_format variants", () => {
  const jsonObjectResult = validateChatCompletionBody({
    model: "demo-model",
    messages: [{ role: "user", content: "hello" }],
    response_format: { type: "json_object" }
  });
  assert.equal(jsonObjectResult.ok, true);

  const jsonSchemaResult = validateChatCompletionBody({
    model: "demo-model",
    messages: [{ role: "user", content: "hello" }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "demo",
        schema: {
          type: "object",
          properties: {
            answer: { type: "string" }
          }
        }
      }
    }
  });
  assert.equal(jsonSchemaResult.ok, true);
});

test("normalizeChatCompletionBody injects a system instruction for json_object", () => {
  const result = normalizeChatCompletionBody({
    model: "demo-model",
    messages: [{ role: "user", content: "hello" }],
    response_format: { type: "json_object" }
  }) as { messages: Array<{ role: string; content: string }> };

  assert.equal(result.messages[0].role, "system");
  assert.match(result.messages[0].content, /valid JSON object/i);
  assert.equal(result.messages[1].role, "user");
});

test("normalizeChatCompletionBody merges json_schema instruction into an existing system message", () => {
  const result = normalizeChatCompletionBody({
    model: "demo-model",
    messages: [
      { role: "system", content: "existing rule" },
      { role: "user", content: "hello" }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "demo",
        schema: {
          type: "object"
        }
      }
    }
  }) as { messages: Array<{ role: string; content: string }> };

  assert.equal(result.messages[0].role, "system");
  assert.match(result.messages[0].content, /matches this schema/i);
  assert.match(result.messages[0].content, /existing rule/);
});
