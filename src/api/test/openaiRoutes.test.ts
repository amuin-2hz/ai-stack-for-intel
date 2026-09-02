/**
 * Author: zhenz
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";

import { register } from "../src/routes/openai.js";

/**
 * Create a lightweight response mock that captures status, headers, and body.
 */
function createMockResponse() {
  const chunks: Buffer[] = [];
  return {
    status: 0,
    headers: undefined as Record<string, string | number> | undefined,
    writeHead(status: number, headers: Record<string, string | number>) {
      this.status = status;
      this.headers = headers;
    },
    end(chunk?: string | Buffer) {
      if (chunk) chunks.push(Buffer.from(chunk));
    },
    readJson() {
      return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    }
  };
}

/**
 * Create a minimal OpenVINO model directory that the registry treats as ready.
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

test("openai routes reject malformed JSON with OpenAI error payload", async () => {
  const root = join(tmpdir(), "ai-stack-openai-routes-" + Date.now());
  const routes = new Map<string, any>();
  register(
    (method, path, handler) => routes.set(`${method} ${path}`, handler),
    root,
    {},
    { proxyOpenAiRequest: async () => undefined }
  );

  const handler = routes.get("POST /v1/chat/completions");
  const req = Readable.from(["{"]) as any;
  const res = createMockResponse() as any;

  await handler(req, res, {});
  const body = res.readJson();

  assert.equal(res.status, 400);
  assert.equal(body.error.type, "invalid_request_error");
  assert.equal(body.error.code, "invalid_json");
  assert.match(body.error.message, /Invalid JSON body/);

  await rm(root, { recursive: true, force: true });
});

test("openai routes reject chat completions without messages", async () => {
  const root = join(tmpdir(), "ai-stack-openai-chat-validation-" + Date.now());
  const routes = new Map<string, any>();
  register(
    (method, path, handler) => routes.set(`${method} ${path}`, handler),
    root,
    {},
    { proxyOpenAiRequest: async () => undefined }
  );

  const handler = routes.get("POST /v1/chat/completions");
  const req = Readable.from([JSON.stringify({ model: "demo-model" })]) as any;
  const res = createMockResponse() as any;

  await handler(req, res, {});
  const body = res.readJson();

  assert.equal(res.status, 400);
  assert.equal(body.error.param, "messages");
  assert.equal(body.error.code, "invalid_messages");

  await rm(root, { recursive: true, force: true });
});

test("openai routes reject unsupported chat response_format", async () => {
  const root = join(tmpdir(), "ai-stack-openai-chat-format-" + Date.now());
  const routes = new Map<string, any>();
  register(
    (method, path, handler) => routes.set(`${method} ${path}`, handler),
    root,
    {},
    { proxyOpenAiRequest: async () => undefined }
  );

  const handler = routes.get("POST /v1/chat/completions");
  const req = Readable.from([JSON.stringify({
    model: "demo-model",
    messages: [{ role: "user", content: "hello" }],
    response_format: { type: "xml" }
  })]) as any;
  const res = createMockResponse() as any;

  await handler(req, res, {});
  const body = res.readJson();

  assert.equal(res.status, 400);
  assert.equal(body.error.param, "response_format");
  assert.equal(body.error.code, "unsupported_response_format");

  await rm(root, { recursive: true, force: true });
});

test("openai routes reject unsupported tool definitions", async () => {
  const root = join(tmpdir(), "ai-stack-openai-tool-validation-" + Date.now());
  const routes = new Map<string, any>();
  register(
    (method, path, handler) => routes.set(`${method} ${path}`, handler),
    root,
    {},
    { proxyOpenAiRequest: async () => undefined }
  );

  const handler = routes.get("POST /v1/chat/completions");
  const req = Readable.from([JSON.stringify({
    model: "demo-model",
    messages: [{ role: "user", content: "hello" }],
    tools: [{
      type: "function",
      function: {
        name: "runShell",
        parameters: { type: "object", properties: {} }
      }
    }]
  })]) as any;
  const res = createMockResponse() as any;

  await handler(req, res, {});
  const body = res.readJson();

  assert.equal(res.status, 400);
  assert.equal(body.error.param, "tools");
  assert.equal(body.error.code, "unsupported_tool");

  await rm(root, { recursive: true, force: true });
});

test("openai routes expose ready models using public model names", async () => {
  const root = join(tmpdir(), "ai-stack-openai-models-" + Date.now());
  await mkdir(root, { recursive: true });
  await createReadyChatModel(root, "Qwen3-Chat-Model");

  const routes = new Map<string, any>();
  register(
    (method, path, handler) => routes.set(`${method} ${path}`, handler),
    root,
    {},
    { proxyOpenAiRequest: async () => undefined }
  );

  const handler = routes.get("GET /v1/models");
  const res = createMockResponse() as any;

  await handler({} as any, res, {});
  const body = res.readJson();

  assert.equal(res.status, 200);
  assert.equal(body.object, "list");
  assert.ok(body.data.some((model: { id: string }) => model.id === "qwen3-chat-model"));

  await rm(root, { recursive: true, force: true });
});

test("openai routes reject unsupported speech response_format", async () => {
  const root = join(tmpdir(), "ai-stack-openai-speech-validation-" + Date.now());
  const routes = new Map<string, any>();
  register(
    (method, path, handler) => routes.set(`${method} ${path}`, handler),
    root,
    {},
    { proxyOpenAiRequest: async () => undefined }
  );

  const handler = routes.get("POST /v1/audio/speech");
  const req = Readable.from([JSON.stringify({
    model: "demo-model",
    input: "hello",
    response_format: "mp3"
  })]) as any;
  const res = createMockResponse() as any;

  await handler(req, res, {});
  const body = res.readJson();

  assert.equal(res.status, 400);
  assert.equal(body.error.param, "response_format");
  assert.equal(body.error.code, "unsupported_response_format");

  await rm(root, { recursive: true, force: true });
});
