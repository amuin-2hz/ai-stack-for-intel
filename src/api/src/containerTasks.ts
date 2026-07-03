/**
 * Container tasks — adapted for LocalRuntime engine management.
 * Task creation helpers that now work with subprocess engines instead of Docker.
 */

import { join } from "node:path";
import { createTask, runManagedCommand } from "./taskRunner.js";
import { createTask as persistTask } from "./store.js";
import { enginePresets } from "./engineManager.js";

/* ── custom container (now: engine config task) ──── */
export async function createCustomContainerTask(request: any, baseDir: string, logsRoot: string) {
  const name = request.name?.trim() || "custom_engine_" + Date.now();
  const task = createTask("container", "# Custom engine configuration: " + name, baseDir,
    join(logsRoot, "tasks", "engine-" + name + ".log"),
    { name, custom: true });
  await persistTask(task);
  return { status: "queued", task };
}

/* ── image pull → now a no-op (no Docker images) ─── */
export async function createImagePullTask(key: string, baseDir: string, logsRoot: string) {
  const preset = enginePresets.find((p) => p.type === key);
  const task = createTask("container", "# Engine ready: " + (preset?.title ?? key),
    baseDir,
    join(logsRoot, "tasks", "engine-" + key + "-ready.log"),
    { action: "engine_ready", key });
  await persistTask(task);
  void runManagedCommand({
    taskId: task.id,
    command: "echo",
    args: ["Engine", preset?.title ?? key, "uses local Python subprocess — no image pull needed."],
    cwd: baseDir,
    logPath: task.log_path
  });
  return { status: "starting", task };
}

/* ── image test → now verifies Python/env ─────────── */
export async function createImageTestTask(key: string, baseDir: string, logsRoot: string) {
  const preset = enginePresets.find((p) => p.type === key);
  const command = [
    "python3 -c \"from openvino import Core; c=Core(); print('Devices:', c.available_devices)\"",
    "python3 -c \"import openvino_genai; print('openvino-genai OK')\""
  ].join(" && ");
  const task = createTask("container", command, baseDir,
    join(logsRoot, "tasks", "engine-" + key + "-test.log"),
    { action: "test_environment", key });
  await persistTask(task);
  void runManagedCommand({
    taskId: task.id,
    command: "bash",
    args: ["-lc", command],
    cwd: baseDir,
    logPath: task.log_path
  });
  return { status: "starting", task };
}

/* ── runtime start test ──────────────────────────── */
export async function createRuntimeStartTestTask(key: string, baseDir: string, logsRoot: string) {
  const task = createTask("container",
    "# Runtime start test: " + key,
    baseDir,
    join(logsRoot, "tasks", "runtime-" + key + "-start-test.log"),
    { action: "test_runtime", key });
  await persistTask(task);
  void runManagedCommand({
    taskId: task.id,
    command: "echo",
    args: ["Runtime", key, "start test — use POST /engines/" + key + "/start instead."],
    cwd: baseDir,
    logPath: task.log_path
  });
  return { status: "starting", task };
}

/* ── list containers → thin wrapper ──────────────── */
export async function listContainers() {
  const { listEngines } = await import("./engineManager.js");
  const engines = listEngines();
  const engineMap = new Map(engines.map((e) => [e.type, e]));

  // Always return all engine presets — map engine status to container state
  const containers = enginePresets.map((preset) => {
    const engine = engineMap.get(preset.type);
    // Preserve intermediate states: running, starting, error, stopped
    const engineState = engine?.status ?? "stopped";
    return {
      key: preset.type,
      name: preset.type + "-service",
      slot_name: preset.type + "-service",
      instance_name: engine?.id ?? null,
      title: preset.title,
      image: preset.script,
      status: engineState,
      state: engineState as "running" | "stopped" | "starting" | "error",
      ports: String(engine?.port ?? preset.default_port),
      public_port: engine?.port ?? preset.default_port,
      runtime: preset.type,
      management_mode: "resident" as const,
      restart_policy: "no" as const,
      auto_restart: false,
      preset: true,
      components: preset.components,
      official_image: preset.script,
      image_pulled: true,
      test_status: "passed" as const,
      software_versions: {}
    };
  });

  return {
    containers,
    components: ["python", "openvino", "openvino-genai"],
    modes: ["resident"],
    restart_policies: ["no"]
  };
}

export { listContainers as containerLogs };
