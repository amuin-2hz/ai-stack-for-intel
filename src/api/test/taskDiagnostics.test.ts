import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { diagnoseTask } from "../src/taskDiagnostics.js";

test("diagnoseTask maps health failures to the health stage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ai-stack-diagnostics-"));
  try {
    const logPath = join(dir, "task.log");
    await writeFile(logPath, "Runtime health check timeout for http://localhost:30000/health: ECONNREFUSED", "utf-8");
    const diagnostic = await diagnoseTask({ status: "failed", log_path: logPath });
    assert.equal(diagnostic?.category, "health_check_timeout");
    assert.equal(diagnostic?.stage, "health");
    assert.equal(diagnostic?.repair_actions[0]?.action, "view_logs");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("diagnoseTask maps image pull failures to the pull stage", async () => {
  const diagnostic = await diagnoseTask({
    status: "failed",
    error: "failed to resolve image vllm/vllm-openai:latest: TLS handshake timeout"
  });
  assert.equal(diagnostic?.category, "image_pull_failed");
  assert.equal(diagnostic?.stage, "pull");
  assert.ok(diagnostic?.repair_actions.some((action) => action.action === "change_image"));
});

test("diagnoseTask maps port conflicts to the start stage", async () => {
  const diagnostic = await diagnoseTask({
    status: "failed",
    error: "Error response from daemon: driver failed programming external connectivity: bind: address already in use"
  });
  assert.equal(diagnostic?.category, "port_in_use");
  assert.equal(diagnostic?.stage, "start");
  assert.ok(diagnostic?.repair_actions.some((action) => action.action === "change_port"));
});

test("diagnoseTask falls back to runtime plan current stage", async () => {
  const diagnostic = await diagnoseTask({
    status: "failed",
    error: "Task process was interrupted or the management service restarted before completion.",
    metadata: { runtime_plan: { current_stage: "prepare" } }
  });
  assert.equal(diagnostic?.category, "unknown_failure");
  assert.equal(diagnostic?.stage, "prepare");
});
