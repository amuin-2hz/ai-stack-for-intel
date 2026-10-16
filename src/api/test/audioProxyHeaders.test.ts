/**
 * Author: zhenz
 *
 * 回归：音频代理分支必须一次响应只写一次响应头。
 * 背景：原实现先在 /audio/* 分支无条件 writeHead，transcriptions 分支又格式化后再写一次；
 * 一旦格式化或上游回包处理失败，外层 catch 会在"头已发出"之后再写，
 * Node 抛 ERR_HTTP_HEADERS_SENT，进程被未捕获异常带走。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { EngineRecord } from "../src/engineManager.js";
import { createOpenAiProxy } from "../src/openaiProxy.js";

/** 构造严格响应替身：第二次 writeHead 像真实 Node 一样抛错，从而把"双写"变成失败。 */
function createStrictResponse() {
  const chunks: Buffer[] = [];
  return {
    headersSent: false,
    writableEnded: false,
    status: 0,
    writeHeadCalls: 0,
    writeHead(status: number) {
      this.writeHeadCalls += 1;
      if (this.headersSent) {
        const error = new Error("Cannot write headers after they are sent to the client");
        (error as Error & { code?: string }).code = "ERR_HTTP_HEADERS_SENT";
        throw error;
      }
      this.status = status;
      this.headersSent = true;
    },
    write(chunk: string | Buffer) {
      chunks.push(Buffer.from(chunk));
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk) chunks.push(Buffer.from(chunk));
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
    }
  };
}

/** 构造一个运行中的 ASR 引擎记录。 */
function createRunningAsrEngine(modelName: string): EngineRecord {
  return {
    id: "eng_asr_test",
    type: "asr",
    model_id: modelName,
    model_name: modelName,
    device: "CPU",
    port: 31002,
    pid: 4321,
    status: "running",
    script: "src/inference/asr.py",
    started_at: new Date().toISOString()
  } as EngineRecord;
}

test("audio transcriptions 成功路径只写一次响应头", async () => {
  const root = join(tmpdir(), "ai-stack-audio-headers-" + Date.now());
  const modelsRoot = join(root, "models");
  const logsRoot = join(root, "logs");
  await mkdir(modelsRoot, { recursive: true });
  await mkdir(logsRoot, { recursive: true });
  try {
    const proxy = createOpenAiProxy(
      { modelsRoot, workspaceRoot: root, logsRoot, deploymentHelpers: {} as never },
      {
        listEngines: () => [createRunningAsrEngine("qwen3-asr-test")],
        requestAudioWebSocket: async () => ({
          ok: true,
          status: 200,
          body: Buffer.from(JSON.stringify({ text: "你好" })),
          contentType: "application/json; charset=utf-8"
        })
      }
    );

    const res = createStrictResponse();
    await proxy.proxyOpenAiRequest(res as never, { model: "qwen3-asr-test" }, "/audio/transcriptions");

    assert.equal(res.writeHeadCalls, 1, "一次响应只允许写一次响应头");
    assert.equal(res.status, 200);
    assert.match(res.readText(), /你好/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("audio transcriptions 上游 4xx/5xx 走结构化 OpenAI 错误，也只写一次响应头", async () => {
  const root = join(tmpdir(), "ai-stack-audio-error-" + Date.now());
  const modelsRoot = join(root, "models");
  const logsRoot = join(root, "logs");
  await mkdir(modelsRoot, { recursive: true });
  await mkdir(logsRoot, { recursive: true });
  try {
    const proxy = createOpenAiProxy(
      { modelsRoot, workspaceRoot: root, logsRoot, deploymentHelpers: {} as never },
      {
        listEngines: () => [createRunningAsrEngine("qwen3-asr-test")],
        requestAudioWebSocket: async () => ({
          ok: false,
          status: 500,
          body: Buffer.from(JSON.stringify({ error: "engine exploded" })),
          contentType: "application/json; charset=utf-8"
        })
      }
    );

    const res = createStrictResponse();
    await proxy.proxyOpenAiRequest(res as never, { model: "qwen3-asr-test" }, "/audio/transcriptions");

    assert.equal(res.writeHeadCalls, 1, "错误路径同样只写一次响应头");
    assert.equal(res.status, 500);
    // 上游错误体经 normalizeOpenAiErrorPayload 规范化：形状不合规时用固定文案，
    // 这里只要求它是结构化的 OpenAI 错误、且不再二次写头。
    const payload = JSON.parse(res.readText());
    assert.equal(payload.error.type, "server_error");
    assert.equal(typeof payload.error.message, "string");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
