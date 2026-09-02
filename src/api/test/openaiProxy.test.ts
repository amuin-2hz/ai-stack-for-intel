/**
 * Author: zhenz
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { EngineRecord } from "../src/engineManager.js";
import type { ProxyResult } from "../src/httpProxy.js";
import { createOpenAiProxy } from "../src/openaiProxy.js";

/**
 * Create a writable response double that captures headers and response chunks.
 */
function createMockResponse() {
  const chunks: Buffer[] = [];
  return {
    destroyed: false,
    writableEnded: false,
    status: 0,
    headers: undefined as Record<string, string | number> | undefined,
    writeHead(status: number, headers: Record<string, string | number>) {
      this.status = status;
      this.headers = headers;
    },
    write(chunk: string | Buffer) {
      chunks.push(Buffer.from(chunk));
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk) {
        chunks.push(Buffer.from(chunk));
      }
      this.writableEnded = true;
    },
    once() {
      return this;
    },
    off() {
      return this;
    },
    readText() {
      return Buffer.concat(chunks).toString("utf-8");
    },
    readJson() {
      return JSON.parse(this.readText());
    }
  };
}

/**
 * Create a minimal OpenVINO chat model directory recognized as ready.
 */
async function createReadyChatModel(modelsRoot: string, dirName: string): Promise<void> {
  const modelDir = join(modelsRoot, dirName);
  await mkdir(modelDir, { recursive: true });
  await writeFile(join(modelDir, "openvino_model.xml"), "<xml />", "utf-8");
  await writeFile(join(modelDir, "openvino_model.bin"), "weights", "utf-8");
  await writeFile(join(modelDir, "config.json"), JSON.stringify({ model_type: "qwen2" }), "utf-8");
  await writeFile(join(modelDir, "tokenizer_config.json"), JSON.stringify({
    chat_template: "{% for message in messages %}{{ message.content }}{% endfor %}"
  }), "utf-8");
}

/**
 * Build a running chat engine record for proxy tests.
 */
function createRunningChatEngine(modelName: string): EngineRecord {
  return {
    id: "eng_chat_test",
    type: "chat",
    model_id: modelName,
    model_name: modelName,
    device: "CPU",
    port: 31000,
    pid: 12345,
    status: "running",
    script: "src/inference/chat.py",
    started_at: new Date().toISOString()
  };
}

/**
 * Build a successful upstream JSON proxy result.
 */
function buildJsonProxyResult(payload: unknown): ProxyResult {
  return {
    ok: true,
    status: 200,
    body: Buffer.from(JSON.stringify(payload)),
    contentType: "application/json; charset=utf-8"
  };
}

test("openai proxy injects tool calls into non-stream tool-assisted chat completions", async () => {
  const root = join(tmpdir(), "ai-stack-openai-proxy-" + Date.now());
  const modelsRoot = join(root, "models");
  const logsRoot = join(root, "logs");
  const upstreamRequests: Array<Record<string, unknown>> = [];
  await mkdir(modelsRoot, { recursive: true });
  await mkdir(logsRoot, { recursive: true });
  await createReadyChatModel(modelsRoot, "Qwen3-Chat-Model");

  const proxy = createOpenAiProxy({
    modelsRoot,
    workspaceRoot: root,
    logsRoot,
    deploymentHelpers: {} as never
  }, {
    listEngines: () => [createRunningChatEngine("qwen3-chat-model")],
    proxyHttp: async (method, url, body) => {
      upstreamRequests.push({
        method,
        url,
        body: JSON.parse(String(body ?? "{}"))
      });
      return buildJsonProxyResult({
        id: "chatcmpl_tool_1",
        object: "chat.completion",
        model: "qwen3-chat-model",
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: "I found one local model."
          },
          finish_reason: "stop"
        }]
      });
    }
  });

  try {
    const res = createMockResponse() as any;
    await proxy.proxyOpenAiRequest(res, {
      model: "qwen3-chat-model",
      messages: [{ role: "user", content: "请列出本地模型" }],
      tools: [{
        type: "function",
        function: {
          name: "listLocalModels",
          parameters: {
            type: "object",
            properties: {}
          }
        }
      }],
      tool_choice: {
        type: "function",
        function: { name: "listLocalModels" }
      }
    }, "/chat/completions");

    const body = res.readJson();
    const upstreamBody = upstreamRequests[0].body as Record<string, unknown>;
    const upstreamMessages = upstreamBody.messages as Array<Record<string, unknown>>;

    assert.equal(res.status, 200);
    assert.equal(body.choices[0].message.tool_calls[0].function.name, "listLocalModels");
    assert.equal(upstreamBody.model, "qwen3-chat-model");
    assert.equal(upstreamBody.stream, false);
    assert.equal(upstreamBody.tool_choice, "none");
    assert.equal(upstreamMessages.at(-2)?.role, "assistant");
    assert.equal(upstreamMessages.at(-1)?.role, "tool");
    assert.match(String(upstreamMessages.at(-1)?.content ?? ""), /qwen3-chat-model/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("openai proxy synthesizes SSE chunks for stream tool-assisted chat completions", async () => {
  const root = join(tmpdir(), "ai-stack-openai-proxy-stream-" + Date.now());
  const modelsRoot = join(root, "models");
  const logsRoot = join(root, "logs");
  const upstreamRequests: Array<Record<string, unknown>> = [];
  await mkdir(modelsRoot, { recursive: true });
  await mkdir(logsRoot, { recursive: true });
  await createReadyChatModel(modelsRoot, "Qwen3-Chat-Model");

  const proxy = createOpenAiProxy({
    modelsRoot,
    workspaceRoot: root,
    logsRoot,
    deploymentHelpers: {} as never
  }, {
    listEngines: () => [createRunningChatEngine("qwen3-chat-model")],
    proxyHttp: async (_method, _url, body) => {
      upstreamRequests.push({
        body: JSON.parse(String(body ?? "{}"))
      });
      return buildJsonProxyResult({
        id: "chatcmpl_tool_stream_1",
        object: "chat.completion",
        model: "qwen3-chat-model",
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: "Local models are ready."
          },
          finish_reason: "stop"
        }]
      });
    }
  });

  try {
    const res = createMockResponse() as any;
    await proxy.proxyOpenAiRequest(res, {
      model: "qwen3-chat-model",
      stream: true,
      messages: [{ role: "user", content: "请列出本地模型" }],
      tools: [{
        type: "function",
        function: {
          name: "listLocalModels",
          parameters: {
            type: "object",
            properties: {}
          }
        }
      }],
      tool_choice: {
        type: "function",
        function: { name: "listLocalModels" }
      }
    }, "/chat/completions");

    const streamText = res.readText();
    const upstreamBody = upstreamRequests[0].body as Record<string, unknown>;

    assert.equal(res.status, 200);
    assert.equal(res.headers?.["Content-Type"], "text/event-stream");
    assert.equal(upstreamBody.stream, false);
    assert.match(streamText, /"role":"assistant"/);
    assert.match(streamText, /"tool_calls":\[\{"index":0,"id":"call_/);
    assert.match(streamText, /"arguments":"\{\}"/);
    assert.match(streamText, /"content":"Local models are"/);
    assert.match(streamText, /"content":" ready\."/);
    assert.match(streamText, /\[DONE\]/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
