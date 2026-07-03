import { readFile } from "node:fs/promises";
import type { RepairAction, TaskDiagnostic } from "./types.js";

type DiagnosableTask = { status: string; error?: string; log_path?: string; metadata?: Record<string, unknown> };

type DiagnosticRule = {
  category: string;
  severity: TaskDiagnostic["severity"];
  stage: NonNullable<TaskDiagnostic["stage"]>;
  patterns: RegExp[];
  message: string;
  repair_actions: RepairAction[];
};

const rules: DiagnosticRule[] = [
  {
    category: "docker_unavailable",
    severity: "error",
    stage: "prepare",
    patterns: [/Cannot connect to the Docker daemon/i, /docker.*permission denied/i, /Docker CLI is unavailable/i],
    message: "Docker is unavailable to the API process.",
    repair_actions: [
      { action: "start_docker", label: "Start Docker and retry." },
      { action: "check_docker_socket", label: "Check Docker socket permissions." }
    ]
  },
  {
    category: "port_in_use",
    severity: "error",
    stage: "start",
    patterns: [/port is already allocated/i, /address already in use/i, /bind:.*address already in use/i],
    message: "The configured runtime port is already in use.",
    repair_actions: [
      { action: "change_port", label: "Change the runtime public port." },
      { action: "stop_conflicting_service", label: "Stop the process or container using this port." }
    ]
  },
  {
    category: "image_pull_failed",
    severity: "error",
    stage: "pull",
    patterns: [/pull access denied/i, /manifest unknown/i, /failed to (?:resolve|pull) image/i, /network.*timeout/i, /TLS handshake timeout/i, /i\/o timeout/i],
    message: "Container image pull failed.",
    repair_actions: [
      { action: "check_network", label: "Check network or proxy settings." },
      { action: "pull_image", label: "Pull the configured image again." },
      { action: "change_image", label: "Use a reachable image tag." }
    ]
  },
  {
    category: "model_files_missing",
    severity: "error",
    stage: "prepare",
    patterns: [/No such file or directory/i, /model.*not found/i, /config\.json.*missing/i, /tokenizer.*not found/i],
    message: "Required model files are missing.",
    repair_actions: [
      { action: "redownload_model", label: "Download the model again." },
      { action: "inspect_model_files", label: "Inspect model config, tokenizer, and weights." }
    ]
  },
  {
    category: "gpu_memory_insufficient",
    severity: "error",
    stage: "start",
    patterns: [/CUDA out of memory/i, /out of memory/i, /insufficient.*memory/i, /No available memory/i, /no CUDA-capable device/i, /NVIDIA.*driver/i],
    message: "GPU memory is insufficient for this task.",
    repair_actions: [
      { action: "lower_context_length", label: "Lower context length or max tokens." },
      { action: "stop_other_runtimes", label: "Stop other GPU runtimes." },
      { action: "choose_smaller_model", label: "Choose a smaller or quantized model." }
    ]
  },
  {
    category: "vllm_args_incompatible",
    severity: "error",
    stage: "start",
    patterns: [/unrecognized arguments/i, /invalid choice/i, /max_model_len/i, /tensor_parallel_size/i, /kv_cache_dtype/i],
    message: "vLLM rejected one or more runtime parameters.",
    repair_actions: [
      { action: "reset_runtime_params", label: "Reset vLLM parameters to defaults." },
      { action: "lower_context_length", label: "Lower context length." }
    ]
  },
  {
    category: "health_check_timeout",
    severity: "warning",
    stage: "health",
    patterns: [/health.*timeout/i, /health.*unavailable/i, /connection refused/i, /ECONNREFUSED/i, /container.*unhealthy/i, /dependency failed to start/i],
    message: "Runtime health check did not become ready in time.",
    repair_actions: [
      { action: "view_logs", label: "View runtime logs." },
      { action: "restart_runtime", label: "Restart the runtime." }
    ]
  }
];

export async function diagnoseTask(task: DiagnosableTask): Promise<TaskDiagnostic | undefined> {
  if (!shouldDiagnose(task)) return undefined;
  const log = task.log_path ? await readFile(task.log_path, "utf-8").catch(() => "") : "";
  const haystack = [task.error, log].filter(Boolean).join("\n");
  if (!haystack) return undefined;
  for (const rule of rules) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      return { category: rule.category, severity: rule.severity, stage: rule.stage, message: rule.message, repair_actions: rule.repair_actions };
    }
  }
  return {
    category: "unknown_failure",
    severity: "error",
    stage: runtimePlanStage(task) ?? "unknown",
    message: task.error || "Task failed; inspect logs for details.",
    repair_actions: [{ action: "view_logs", label: "View task logs." }]
  };
}

function runtimePlanStage(task: DiagnosableTask): TaskDiagnostic["stage"] | undefined {
  const plan = task.metadata?.runtime_plan;
  if (!plan || typeof plan !== "object") return undefined;
  const stage = (plan as { current_stage?: unknown }).current_stage;
  if (["prepare", "pull", "start", "health"].includes(String(stage))) return stage as TaskDiagnostic["stage"];
  return undefined;
}

function shouldDiagnose(task: DiagnosableTask): boolean {
  return task.status === "failed" || Boolean(task.error);
}
