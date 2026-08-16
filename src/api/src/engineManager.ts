/**
 * Engine Manager — manages inference engine subprocesses.
 * Replaces containerDocker/containerManager/containerTasks for LocalRuntime.
 *
 * Instead of Docker containers, we spawn Python inference scripts as child
 * processes, each listening on a local HTTP port for OpenAI-compatible requests.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { access } from "node:fs/promises";
import { runCommand } from "./utils.js";

/* ── types ───────────────────────────────────────── */
export type EngineType = "chat" | "vision" | "asr" | "tts" | "embedding" | "rerank";
export type EngineDevice = "NPU" | "GPU" | "CPU";
export type EngineStatus = "stopped" | "starting" | "running" | "error";

export interface EngineRecord {
  id: string;
  type: EngineType;
  model_id: string;
  model_name: string;
  device: EngineDevice;
  port: number;
  pid: number | null;
  status: EngineStatus;
  script: string;
  started_at: string | null;
  error?: string;
}

export interface EnginePreset {
  type: EngineType;
  title: string;
  script: string;
  default_port: number;
  default_device: EngineDevice;
  default_model: string;
  model_keywords: string[];
  components: string[];
}

/* ── engine presets ──────────────────────────────── */
export const enginePresets: EnginePreset[] = [
  {
    type: "chat",
    title: "LLM Chat",
    script: "src/inference/chat.py",
    default_port: 31000,
    default_device: "GPU",
    default_model: "Qwen3.5-2B-fp16-ov",
    model_keywords: ["qwen", "llama", "chat", "llm", "phi"],
    components: ["python", "openvino", "openvino-genai"]
  },
  {
    type: "vision",
    title: "Vision (VLM)",
    script: "src/inference/vision.py",
    default_port: 31001,
    default_device: "GPU",
    default_model: "Qwen3-VL-4B-Instruct-int4_asym-ov",
    model_keywords: ["vision", "vl", "vlm", "multimodal"],
    components: ["python", "openvino", "openvino-genai"]
  },
  {
    type: "asr",
    title: "ASR (Speech-to-Text)",
    script: "src/inference/asr.py",
    default_port: 31002,
    default_device: "NPU",
    default_model: "Qwen3-ASR-0.6B-int8-ov",
    model_keywords: ["asr", "whisper", "speech", "audio"],
    components: ["python", "openvino", "openvino-genai"]
  },
  {
    type: "tts",
    title: "TTS (Text-to-Speech)",
    script: "src/inference/tts_qwen.py",
    default_port: 31003,
    default_device: "CPU",
    default_model: "Qwen3-TTS-0.6B-CustomVoice",
    model_keywords: ["tts", "qwen3-tts", "customvoice", "speech", "voice"],
    components: ["python", "torch", "qwen-tts"]
  },
  {
    type: "embedding",
    title: "Embedding",
    script: "src/inference/embeddings.py",
    default_port: 31004,
    default_device: "NPU",
    default_model: "Qwen3-Embedding-0.6B-fp16-ov",
    model_keywords: ["embedding", "embed", "retrieval", "bge"],
    components: ["python", "openvino", "openvino-genai"]
  },
  {
    type: "rerank",
    title: "Rerank",
    script: "src/inference/rerank.py",
    default_port: 31005,
    default_device: "GPU",
    default_model: "Qwen3-Reranker-0.6B-fp16-ov",
    model_keywords: ["rerank", "reranker", "ranking", "cross-encoder"],
    components: ["python", "openvino", "openvino-genai"]
  }
];

/* ── engine table ────────────────────────────────── */
const engines = new Map<string, EngineRecord>();

/* ── header helpers ──────────────────────────────── */
function randomId(prefix = "eng"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

const now = () => new Date().toISOString();

/* ── public API ──────────────────────────────────── */

/** List all known engines (running + stopped) */
export function listEngines(): EngineRecord[] {
  return [...engines.values()].sort((a, b) => a.type.localeCompare(b.type));
}

/** Get a single engine by id */
export function getEngine(id: string): EngineRecord | undefined {
  return engines.get(id);
}

/** Get engine by type (only one per type can be running) */
export function getEngineByType(type: EngineType): EngineRecord | undefined {
  return [...engines.values()].find((e) => e.type === type && e.status !== "stopped");
}

/** Guess which preset fits a model directory name */
export function presetForModel(modelName: string): EnginePreset | undefined {
  const lower = modelName.toLowerCase();
  return enginePresets.find((p) =>
    p.model_keywords.some((kw) => lower.includes(kw.toLowerCase()))
  );
}

/** Detect available devices (NPU / GPU / CPU) */
export async function detectDevices(): Promise<{ NPU: boolean; GPU: boolean; CPU: boolean }> {
  const result: { NPU: boolean; GPU: boolean; CPU: boolean } = {
    NPU: false,
    GPU: false,
    CPU: true // always available as fallback
  };

  // Check NPU via OpenVINO or /dev/accel
  try {
    const npuCheck = await runCommand("python3", [
      "-c",
      "from openvino import Core; c=Core(); print(','.join(c.available_devices))"
    ], 10000);
    if (npuCheck.ok && npuCheck.stdout.toLowerCase().includes("npu")) {
      result.NPU = true;
    }
  } catch { /* ignore */ }

  // Check /dev/accel for NPU (use access() — reading a char device blocks)
  try {
    await access("/dev/accel/accel0");
    result.NPU = true;
  } catch { /* not present */ }

  // Check GPU
  try {
    const gpuCheck = await runCommand("python3", [
      "-c",
      "from openvino import Core; c=Core(); print(','.join(c.available_devices))"
    ], 10000);
    if (gpuCheck.ok && gpuCheck.stdout.toLowerCase().includes("gpu")) {
      result.GPU = true;
    }
  } catch { /* ignore */ }

  return result;
}

/** Resolve the best available device for an engine type using residency plan */
export async function resolveDevice(engineType: EngineType): Promise<EngineDevice> {
  const devices = await detectDevices();
  // Residency plan: ASR/Embedding→NPU, LLM/VLM/Rerank→GPU, TTS→CPU.
  if (engineType === "asr" && devices.NPU) return "NPU";
  if (engineType === "embedding" && devices.NPU) return "NPU";
  if (engineType === "tts") return "CPU";
  if (devices.GPU) return "GPU";
  return "CPU";
}

/**
 * Start an inference engine.
 * Spawns a Python script with --port and --device flags,
 * waits for it to become healthy, and stores its state.
 */
export async function startEngine(params: {
  type: EngineType;
  model_id: string;
  model_name: string;
  model_path: string;
  device?: EngineDevice;
  port?: number;
  workspaceRoot: string;
  logsRoot: string;
}): Promise<EngineRecord> {
  const preset = enginePresets.find((p) => p.type === params.type);
  if (!preset) throw new Error(`Unknown engine type: ${params.type}`);

  // Stop any existing engine of this type
  const existing = getEngineByType(params.type);
  if (existing && existing.status !== "stopped") {
    await stopEngine(existing.id);
  }

  const resolvedModelPath = isAbsolute(params.model_path)
    ? params.model_path
    : join(params.workspaceRoot, params.model_path);
  let qwen3AsrThinker = false;
  if (params.type === "asr") {
    try {
      await access(join(resolvedModelPath, "thinker", "openvino_thinker_language_model.xml"));
      qwen3AsrThinker = true;
    } catch { /* stable ASR layout */ }
  }

  let device = params.device ?? (await resolveDevice(params.type));
  if (qwen3AsrThinker && device === "NPU") {
    const devices = await detectDevices();
    device = devices.GPU ? "GPU" : "CPU";
  }

  const port = params.port ?? preset.default_port;
  const id = randomId(params.type);
  const script = qwen3AsrThinker ? "src/inference/asr_qwen3.py" : preset.script;
  const scriptPath = join(params.workspaceRoot, script);
  const pythonExecutable = qwen3AsrThinker
    ? process.env.QWEN3_ASR_PYTHON ?? join(params.workspaceRoot, ".venv", "qwen3-asr", "bin", "python")
    : "python3";
  if (qwen3AsrThinker) {
    try {
      await access(pythonExecutable);
    } catch {
      throw new Error("Qwen3-ASR runtime is not installed. Run ops/scripts/setup-qwen3-asr-runtime.sh first.");
    }
  }
  const modelsRoot = join(params.workspaceRoot, "models");

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    MODELS_ROOT: modelsRoot,
    ENGINE_PORT: String(port),
    ENGINE_DEVICE: device,
    ENGINE_TYPE: params.type,
    ENGINE_MODEL_NAME: params.model_name,
    ENGINE_MODEL_ID: params.model_id
  };

  const child = spawn(pythonExecutable, [
    scriptPath,
    "--port", String(port),
    "--host", "127.0.0.1",
    "--device", device,
    "--model-path", params.model_path
  ], {
    cwd: params.workspaceRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false
  });

  const record: EngineRecord = {
    id,
    type: params.type,
    model_id: params.model_id,
    model_name: params.model_name,
    device,
    port,
    pid: child.pid ?? null,
    status: "starting",
    script,
    started_at: now(),
  };

  // Log output
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutChunks.push(chunk.toString());
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk.toString());
  });

  child.on("error", (err: Error) => {
    record.status = "error";
    record.error = err.message;
    engines.set(id, record);
  });

  child.on("exit", (code: number | null, signal: string | null) => {
    const stderr = stderrChunks.join("").trim();
    const stdout = stdoutChunks.join("").trim();
    if (record.status === "starting") {
      record.status = "error";
      record.error = `Process exited with code ${code} before becoming ready`;
      if (stderr) record.error += `\nstderr: ${stderr.slice(0, 500)}`;
    } else if (record.status === "running") {
      record.status = "stopped";
      const parts: string[] = [];
      if (code !== null) parts.push(`exit code ${code}`);
      if (signal) parts.push(`signal ${signal}`);
      if (stderr) parts.push(`stderr: ${stderr.slice(0, 1000)}`);
      if (stdout) parts.push(`stdout: ${stdout.slice(0, 500)}`);
      if (parts.length) record.error = parts.join(" | ");
    }
    record.pid = null;
    engines.set(id, record);
  });

  engines.set(id, record);

  // Wait for health check — try up to 30 seconds
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const resp = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: controller.signal
      });
      clearTimeout(timer);
      if (resp.ok) {
        record.status = "running";
        engines.set(id, record);
        return record;
      }
    } catch {
      // Still waiting...
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Timeout — mark as error but keep process alive if it's still running
  if (record.status === "starting") {
    record.status = "error";
    record.error = "Health check timed out after 30 seconds";
    record.pid = child.pid ?? null;
  }
  engines.set(id, record);
  return record;
}

/** Stop a running engine by id */
export async function stopEngine(id: string): Promise<{ ok: boolean; detail: string }> {
  const record = engines.get(id);
  if (!record) return { ok: false, detail: `Unknown engine: ${id}` };

  if (record.status === "stopped") {
    return { ok: true, detail: "Engine was already stopped." };
  }

  if (record.pid) {
    try {
      process.kill(record.pid, "SIGTERM");
      // Wait up to 5 s for graceful exit, then SIGKILL
      const deadline = Date.now() + 5000;
      let alive = true;
      while (Date.now() < deadline) {
        try { process.kill(record.pid, 0); } catch { alive = false; break; }
        await new Promise((r) => setTimeout(r, 300));
      }
      if (alive) {
        try { process.kill(record.pid, "SIGKILL"); } catch { /* gone */ }
        // Brief wait for SIGKILL to take effect
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch {
      // Process already gone
    }
  }

  record.status = "stopped";
  record.pid = null;
  engines.set(id, record);
  return { ok: true, detail: `Engine ${id} stopped.` };
}

/** Stop all running engines */
export async function stopAllEngines(): Promise<number> {
  let stopped = 0;
  for (const [id, record] of engines) {
    if (record.status !== "stopped") {
      const result = await stopEngine(id);
      if (result.ok) stopped++;
    }
  }
  return stopped;
}

/** Get engine health status */
export async function engineHealth(record: EngineRecord): Promise<{ healthy: boolean; detail: string }> {
  if (record.status === "stopped") return { healthy: false, detail: "Engine is stopped." };
  if (record.status === "error") return { healthy: false, detail: record.error ?? "Engine is in error state." };
  if (record.status === "starting") return { healthy: false, detail: "Engine is still starting." };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`http://127.0.0.1:${record.port}/health`, {
      signal: controller.signal
    });
    clearTimeout(timer);
    if (resp.ok) return { healthy: true, detail: "OK" };
    return { healthy: false, detail: `Health endpoint returned ${resp.status}` };
  } catch (err) {
    return { healthy: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Check for stale PIDs (processes that died without our knowledge) */
export async function reconcileEngines(): Promise<void> {
  for (const [, record] of engines) {
    if (record.status === "running" && record.pid) {
      try {
        process.kill(record.pid, 0); // signal 0 = just check if exists
      } catch {
        record.status = "stopped";
        record.pid = null;
        engines.set(record.id, record);
      }
    }
  }
}

/**
 * Kill orphan Python inference processes left over from a previous session.
 * Called at API startup to free engine ports before spawning new ones.
 */
export async function cleanupOrphanEngines(): Promise<void> {
  const { execSync } = await import("node:child_process");
  for (const preset of enginePresets) {
    const port = preset.default_port;
    try {
      // Find PID listening on this port
      const result = execSync(
        `ss -tlnp | grep ':${port}' | grep -oP 'pid=\\K\\d+' || true`,
        { encoding: "utf-8", timeout: 3000 }
      ).trim();
      if (result) {
        const pids = result.split("\n").filter(Boolean);
        for (const pidStr of pids) {
          const pid = Number(pidStr);
          if (pid > 1) {
            try {
              process.kill(pid, "SIGTERM");
              console.log(`[engines] Killed orphan process pid=${pid} on port ${port}`);
            } catch {
              // Process might be owned by another user or already gone
            }
          }
        }
      }
    } catch {
      // ss not available or port free — either way, fine
    }
  }
  // Brief wait for ports to be released
  await new Promise((r) => setTimeout(r, 500));
}
