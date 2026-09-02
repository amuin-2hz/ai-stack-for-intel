/**
 * Author: zhenz
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createToolRuntime } from "../src/toolRuntime.js";
import { validateToolDefinitions, validateToolingRequest } from "../src/toolValidator.js";

/**
 * Create a minimal ready model that listModels recognizes.
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

test("validateToolDefinitions rejects unsupported tools", () => {
  const result = validateToolDefinitions([{
    type: "function",
    function: {
      name: "runShell",
      parameters: { type: "object", properties: {} }
    }
  }]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.param, "tools");
    assert.equal(result.code, "unsupported_tool");
  }
});

test("validateToolingRequest rejects unknown named tool_choice", () => {
  const result = validateToolingRequest({
    model: "demo-model",
    messages: [{ role: "user", content: "hello" }],
    tools: [{
      type: "function",
      function: {
        name: "getRuntimeStatus",
        parameters: { type: "object", properties: {} }
      }
    }],
    tool_choice: {
      type: "function",
      function: { name: "listLocalModels" }
    }
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.param, "tool_choice");
    assert.equal(result.code, "unknown_tool_choice");
  }
});

test("validateToolingRequest rejects unsupported parallel_tool_calls", () => {
  const result = validateToolingRequest({
    model: "demo-model",
    messages: [{ role: "user", content: "hello" }],
    tools: [{
      type: "function",
      function: {
        name: "getRuntimeStatus",
        parameters: { type: "object", properties: {} }
      }
    }],
    parallel_tool_calls: true
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.param, "parallel_tool_calls");
    assert.equal(result.code, "unsupported_parallel_tool_calls");
  }
});

test("tool runtime prepares second-pass messages for explicit listLocalModels", async () => {
  const root = join(tmpdir(), "ai-stack-tool-runtime-" + Date.now());
  const modelsRoot = join(root, "models");
  const logsRoot = join(root, "logs");
  await mkdir(modelsRoot, { recursive: true });
  await mkdir(logsRoot, { recursive: true });
  await createReadyChatModel(modelsRoot, "Qwen3-Chat-Model");

  const runtime = createToolRuntime({
    modelsRoot,
    workspaceRoot: root,
    logsRoot
  });

  try {
    const result = await runtime.prepareToolOrchestration({
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
    }, "qwen3-chat-model");

    assert.equal(result.handled, true);
    if ("status" in result) {
      assert.fail("Expected a successful orchestration plan.");
    }
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].function.name, "listLocalModels");

    const messages = result.secondPassBody?.messages as Array<Record<string, unknown>>;
    assert.equal(messages.at(-2)?.role, "assistant");
    assert.ok(Array.isArray(messages.at(-2)?.tool_calls));
    assert.equal(messages.at(-1)?.role, "tool");
    assert.match(String(messages.at(-1)?.content ?? ""), /qwen3-chat-model/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tool runtime auto-selects transcribeLocalAudio when a local audio path is present", async () => {
  const root = join(tmpdir(), "ai-stack-tool-runtime-auto-audio-" + Date.now());
  const modelsRoot = join(root, "models");
  const logsRoot = join(root, "logs");
  await mkdir(modelsRoot, { recursive: true });
  await mkdir(logsRoot, { recursive: true });

  const runtime = createToolRuntime({
    modelsRoot,
    workspaceRoot: root,
    logsRoot
  }, {
    executor: {
      async executeTool(toolName, args) {
        return {
          ok: true,
          content: {
            toolName,
            args
          }
        };
      }
    }
  });

  try {
    const result = await runtime.prepareToolOrchestration({
      model: "demo-model",
      messages: [{ role: "user", content: "请帮我转写 '/tmp/demo clip.wav'，输出中文结果" }],
      tools: [
        {
          type: "function",
          function: {
            name: "listLocalModels",
            parameters: {
              type: "object",
              properties: {}
            }
          }
        },
        {
          type: "function",
          function: {
            name: "transcribeLocalAudio",
            parameters: {
              type: "object",
              properties: {
                audioPath: { type: "string" },
                language: { type: "string", enum: ["zh", "en", "ja", "auto"] }
              },
              required: ["audioPath"]
            }
          }
        }
      ],
      tool_choice: "auto"
    }, "demo-model");

    assert.equal(result.handled, true);
    if ("status" in result) {
      assert.fail("Expected auto tool selection to succeed.");
    }
    assert.equal(result.toolCalls[0].function.name, "transcribeLocalAudio");
    assert.match(result.toolCalls[0].function.arguments, /\/tmp\/demo clip\.wav/);
    assert.match(result.toolCalls[0].function.arguments, /"language":"zh"/);
    assert.equal(result.secondPassBody?.stream, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tool runtime auto-selects getEngineStatus for engine health requests", async () => {
  const root = join(tmpdir(), "ai-stack-tool-runtime-auto-engine-" + Date.now());
  const modelsRoot = join(root, "models");
  const logsRoot = join(root, "logs");
  await mkdir(modelsRoot, { recursive: true });
  await mkdir(logsRoot, { recursive: true });

  const runtime = createToolRuntime({
    modelsRoot,
    workspaceRoot: root,
    logsRoot
  }, {
    executor: {
      async executeTool(toolName, args) {
        return {
          ok: true,
          content: {
            toolName,
            args
          }
        };
      }
    }
  });

  try {
    const result = await runtime.prepareToolOrchestration({
      model: "demo-model",
      messages: [{ role: "user", content: "请查看 chat engine 的状态和端口" }],
      tools: [
        {
          type: "function",
          function: {
            name: "listLocalModels",
            parameters: {
              type: "object",
              properties: {}
            }
          }
        },
        {
          type: "function",
          function: {
            name: "getEngineStatus",
            parameters: {
              type: "object",
              properties: {
                engineType: { type: "string", enum: ["chat", "vision", "asr", "tts", "embedding", "rerank"] }
              }
            }
          }
        }
      ],
      tool_choice: "auto"
    }, "demo-model");

    assert.equal(result.handled, true);
    if ("status" in result) {
      assert.fail("Expected engine status auto selection to succeed.");
    }
    assert.equal(result.toolCalls[0].function.name, "getEngineStatus");
    assert.match(result.toolCalls[0].function.arguments, /"engineType":"chat"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
