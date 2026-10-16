/**
 * Author: zhenz
 *
 * 回归：响应已发出后再次 sendJson/sendText 必须是无害空操作。
 * 背景：2026-10-16 实测，一个 handler 在已 writeHead 之后抛错，server.ts 的 catch 再调
 * sendOpenAiError → sendJson → res.writeHead，Node 抛 ERR_HTTP_HEADERS_SENT；该异常在
 * EventEmitter 回调里无人捕获，直接终止 API 进程并连带杀掉它 warmup 起的推理引擎。
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { sendJson, sendText } from "../src/serverUtils.js";

/** 构造一个像 Node ServerResponse 的替身：第二次 writeHead 会像真实实现一样抛错。 */
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
    end(chunk?: string | Buffer) {
      if (chunk) chunks.push(Buffer.from(chunk));
      this.writableEnded = true;
    },
    readText() {
      return Buffer.concat(chunks).toString("utf-8");
    }
  };
}

test("sendJson 在响应头已发出后是无害空操作，不再二次写头", () => {
  const res = createStrictResponse();
  sendJson(res as never, 200, { ok: true });
  assert.equal(res.status, 200);
  assert.equal(res.writeHeadCalls, 1);
  assert.deepEqual(JSON.parse(res.readText()), { ok: true });

  assert.doesNotThrow(() => sendJson(res as never, 500, { detail: "late error" }));
  assert.equal(res.writeHeadCalls, 1, "已发过响应后不得再写头");
  assert.deepEqual(JSON.parse(res.readText()), { ok: true }, "首个响应体不得被覆盖");
});

test("sendJson 在响应已结束后是无害空操作", () => {
  const res = createStrictResponse();
  sendJson(res as never, 200, { ok: true });
  assert.doesNotThrow(() => sendJson(res as never, 500, { detail: "late error" }));
  assert.equal(res.writeHeadCalls, 1);
});

test("sendText 在响应头已发出后是无害空操作", () => {
  const res = createStrictResponse();
  sendText(res as never, 200, "first");
  assert.equal(res.readText(), "first");
  assert.doesNotThrow(() => sendText(res as never, 500, "late"));
  assert.equal(res.writeHeadCalls, 1);
  assert.equal(res.readText(), "first");
});
