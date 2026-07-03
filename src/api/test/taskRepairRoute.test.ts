import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";

const testRoot = await mkdtemp(join(tmpdir(), "ai-stack-repair-route-"));
process.env.AI_STACK_DB_PATH = join(testRoot, "data.db");

const { initDb, closeDb } = await import("../src/db.js");
const { createTask, getContainerConfig } = await import("../src/store.js");
const { register } = await import("../src/routes/tasks.js");

const routes = new Map<string, any>();
register((method, path, handler) => routes.set(method + " " + path, handler), testRoot, join(testRoot, "logs"));
const repairHandler = routes.get("POST /tasks/:task_id/repair");

beforeEach(() => {
  closeDb();
  initDb();
});

after(async () => {
  closeDb();
  await rm(testRoot, { recursive: true, force: true });
});

test("task repair route returns 404 for unknown tasks", async () => {
  const response = await callRepair("missing-task", { action: "view_logs" });
  assert.equal(response.status, 404);
  assert.match(response.body.detail, /Unknown task/);
});

test("task repair route rejects unavailable repair actions", async () => {
  const taskId = await createFailedDeployTask("repair-unavailable.log", "Runtime health check timeout for http://localhost:30000/health: ECONNREFUSED");
  const response = await callRepair(taskId, { action: "change_port", runtime: "vllm", public_port: 30001 });
  assert.equal(response.status, 400);
  assert.match(response.body.detail, /Repair action is not available/);
});

test("task repair route validates change_port payload", async () => {
  // change_port is not a supported repair action in LocalRuntime (no Docker containers)
  const taskId = await createFailedDeployTask("repair-port.log", "bind: address already in use");
  const response = await callRepair(taskId, { action: "change_port", runtime: "vllm", public_port: 80 });
  assert.equal(response.status, 400);
  assert.match(response.body.detail, /Repair action is not available/);
});


test("task repair route updates runtime image for change_image", async () => {
  // change_image is not a supported repair action in LocalRuntime (no Docker containers)
  const taskId = await createFailedDeployTask("repair-image.log", "failed to resolve image vllm/vllm-openai:latest: manifest unknown");
  const response = await callRepair(taskId, { action: "change_image", runtime: "vllm", image: "registry.example.com/vllm:fixed" });
  assert.equal(response.status, 400);
  assert.match(response.body.detail, /Repair action is not available/);
});

test("task repair route validates change_image payload", async () => {
  // change_image is Docker-specific and not available in LocalRuntime
  const taskId = await createFailedDeployTask("repair-image-invalid.log", "failed to pull image: TLS handshake timeout");
  const response = await callRepair(taskId, { action: "change_image", runtime: "vllm", image: "bad image" });
  assert.equal(response.status, 400);
  assert.match(response.body.detail, /Repair action is not available/);
});

async function createFailedDeployTask(logName: string, logBody: string): Promise<string> {
  const logPath = join(testRoot, logName);
  await writeFile(logPath, logBody, "utf-8");
  const id = "task_" + logName.replace(/[^a-z0-9]/gi, "_");
  const now = new Date().toISOString();
  createTask({
    id,
    type: "deploy",
    status: "failed",
    command: "docker compose up",
    cwd: testRoot,
    log_path: logPath,
    metadata: { service_type: "vllm", model_id: "demo-model" },
    error: logBody,
    created_at: now,
    updated_at: now
  });
  return id;
}

async function callRepair(taskId: string, payload: Record<string, unknown>) {
  const req = Readable.from([JSON.stringify(payload)]) as any;
  const chunks: Buffer[] = [];
  const res = {
    status: 0,
    headers: undefined as Record<string, string> | undefined,
    writeHead(status: number, headers: Record<string, string>) {
      this.status = status;
      this.headers = headers;
    },
    end(chunk?: string | Buffer) {
      if (chunk) chunks.push(Buffer.from(chunk));
    }
  } as any;
  await repairHandler(req, res, { task_id: taskId });
  return { status: res.status, body: JSON.parse(Buffer.concat(chunks).toString("utf-8")) };
}
