import { test } from "node:test";
import assert from "node:assert/strict";
import { healthUrl, publicBaseUrl, runtimeCommandFor, settingsFor } from "../src/runtimePlan.js";

test("runtimeCommandFor renders vLLM deployment command and configured env", () => {
  const settings = settingsFor("vllm", {
    key: "vllm",
    public_port: 30123,
    management_mode: "resident",
    restart_policy: "no",
    auto_restart: false,
    updated_at: "2026-06-21T00:00:00.000Z"
  });
  const command = runtimeCommandFor("vllm", "qwen", "local-qwen", { max_model_len: 8192, gpu_memory_utilization: 45 }, settings);
  assert.equal(command.command, "bash");
  assert.equal(command.env.MODEL_ALIAS, "qwen");
  assert.equal(command.env.OPENAI_MODEL, "local-qwen");
  assert.equal(command.env.VLLM_PUBLIC_PORT, "30123");
  assert.equal(command.env.VLLM_MAX_MODEL_LEN, "8192");
  assert.equal(command.env.VLLM_GPU_MEMORY_UTILIZATION, "45");
  assert.match(command.args.join(" "), /docker compose/);
  assert.match(command.args.join(" "), /pull vllm-worker/);
  assert.match(command.args.join(" "), /__AMUIN_STAGE__:pull:running/);
  assert.match(command.args.join(" "), /__AMUIN_STAGE__:start:running/);
});

test("runtime URLs match public OpenAI and health endpoints", () => {
  assert.equal(publicBaseUrl("vllm", 30000), "http://localhost:30000/v1");
  assert.equal(healthUrl("vllm", 30000), "http://localhost:30000/health");
  assert.equal(publicBaseUrl("pytorch", 32000), "http://localhost:32000");
  assert.equal(healthUrl("pytorch", 32000), "http://localhost:32000/healthz");
});


test("runtime plan exposes prepare, pull, start, and health stages", async () => {
  const { createRuntimePlan } = await import("../src/runtimePlan.js");
  const model: any = {
    id: "demo-model",
    compatibility: { vllm: { status: "compatible", reason: "ok" } }
  };
  const deployment: any = {
    deployment_id: "svc_vllm",
    model_id: null,
    status: "not_started",
    service_type: "vllm",
    runtime: "vllm",
    container_name: "vllm-service",
    public_port: 30000,
    base_url: "http://localhost:30000/v1",
    health_url: "http://localhost:30000/health",
    worker_endpoint: null,
    openai_models: [],
    warnings: []
  };
  const plan = createRuntimePlan(deployment, model, "vllm", "demo", {}, "/workspace");
  assert.deepEqual(plan.stages.map((stage) => stage.id), ["prepare", "pull", "start", "health"]);
  assert.equal(plan.stages[1].label, "Pull image");
  assert.equal(plan.stages[2].label, "Start runtime");
});

test("runtimeCommandFor prefers configured runtime image", () => {
  const vllm = runtimeCommandFor("vllm", "qwen", "local-qwen", {}, {
    key: "vllm", public_port: 30123, management_mode: "resident", restart_policy: "no", auto_restart: false, image: "registry.example.com/vllm:fixed", updated_at: "2026-06-21T00:00:00.000Z"
  });
  assert.equal(vllm.env.VLLM_IMAGE, "registry.example.com/vllm:fixed");

  const trt = runtimeCommandFor("trtllm", "qwen", "local-qwen", {}, {
    key: "trtllm", public_port: 31123, management_mode: "resident", restart_policy: "no", auto_restart: false, image: "registry.example.com/trtllm:fixed", updated_at: "2026-06-21T00:00:00.000Z"
  });
  assert.equal(trt.env.TRTLLM_IMAGE, "registry.example.com/trtllm:fixed");
});
