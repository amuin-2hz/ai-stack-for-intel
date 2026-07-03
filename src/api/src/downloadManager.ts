import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseModelSource } from "./modelRegistry.js";
import { fetchHuggingFaceManifest } from "./modelManifest.js";
import { createTask, runManagedCommand } from "./taskRunner.js";
import { runCommand, shellQuote } from "./utils.js";
import { createTask as persistTask, listTasks, markModelFilesForTask, upsertModelFile } from "./store.js";


export class DownloadConflictError extends Error {
  statusCode = 409;

  constructor(message: string, readonly task: ReturnType<typeof listTasks>[number]) {
    super(message);
    this.name = "DownloadConflictError";
  }
}

export interface ImportRequest {
  url: string;
  alias?: string;
  provider?: string;
  expected_runtime?: string;
}

export function createDownloadPlan(request: ImportRequest, baseDir: string) {
  const model = parseModelSource(request.url, request.alias, request.provider ?? "auto");
  const provider = String(model.provider ?? "unknown");
  const repoId = String(model.repo_id ?? "");
  const alias = String(model.alias ?? "model");
  const command = provider === "modelscope"
    ? "ops/scripts/ms-download.sh " + shellQuote(repoId) + " " + shellQuote(alias)
    : provider === "huggingface"
      ? "ops/scripts/hf-download.sh " + shellQuote(repoId) + " " + shellQuote(alias)
      : null;

  const runtimeHints = runtimeHintsFor(request.url, repoId, alias);

  return {
    status: "parsed",
    download_ready: Boolean(command && repoId),
    message: command ? "Download command is ready." : "Model source parsed, but provider/repo could not be turned into a download command.",
    model: { ...model, runtime_hints: runtimeHints },
    runtime_hints: runtimeHints,
    download: command ? {
      mode: "managed_task",
      command,
      working_directory: baseDir,
      target_path: model.target_path
    } : null
  };
}

export async function startDownload(request: ImportRequest, baseDir: string, logsRoot: string) {
  const plan = createDownloadPlan(request, baseDir);
  if (!plan.download) throw new Error(plan.message);
  const plannedModel = plan.model as Record<string, unknown>;
  const provider = String(plannedModel.provider ?? "");
  const repoId = String(plannedModel.repo_id ?? "");
  const alias = String(plannedModel.alias ?? "model");
  const targetPath = String(plannedModel.target_path ?? "models/" + alias);
  const conflict = await activeDownloadFor(provider, repoId, targetPath);
  if (conflict) {
    throw new DownloadConflictError("A download for this model is already active.", conflict);
  }
  const script = provider === "modelscope" ? "ops/scripts/ms-download.sh" : "ops/scripts/hf-download.sh";
  const task = createTask("download", plan.download.command, baseDir, join(logsRoot, "tasks", "download-" + alias + ".log"), {
    provider,
    repo_id: repoId,
    alias,
    target_path: targetPath,
    expected_runtime: request.expected_runtime ?? "auto",
    runtime_hints: plan.runtime_hints
  });
  persistTask(task);
  const plannedFileCount = await writePlannedDownloadFiles(provider, repoId, alias, task.id);
  if (!plannedFileCount) writeDownloadFileStatus(alias, ".", "downloading", task.id);
  void runManagedCommand({
    taskId: task.id,
    command: "bash",
    args: [script, repoId, alias],
    cwd: baseDir,
    env: { AI_STACK_BASE: baseDir },
    logPath: task.log_path,
    onSuccess: async () => { if (!plannedFileCount) writeDownloadFileStatus(alias, ".", "downloaded", task.id); },
    onCancel: async () => {
      await cleanupDownloadTemp(task.metadata, baseDir);
      if (plannedFileCount) markModelFilesForTask(task.id, "canceled");
      else writeDownloadFileStatus(alias, ".", "canceled", task.id);
    },
    onFailure: async (error) => {
      if (plannedFileCount) markModelFilesForTask(task.id, "failed", error);
      else writeDownloadFileStatus(alias, ".", "failed", task.id, error);
    }
  });
  return { ...plan, task };
}

export async function cleanupDownloadTemp(metadata: Record<string, unknown>, baseDir: string): Promise<string | undefined> {
  const targetPath = typeof metadata.target_path === "string" ? metadata.target_path : undefined;
  if (!targetPath) return undefined;
  const workspaceRoot = resolve(baseDir);
  const modelPath = resolve(workspaceRoot, targetPath);
  if (modelPath !== workspaceRoot && !modelPath.startsWith(workspaceRoot + "/")) return undefined;
  const tempPath = join(modelPath, ".temp");
  await rm(tempPath, { recursive: true, force: true });
  return tempPath;
}

async function activeDownloadFor(provider: string, repoId: string, targetPath: string) {
  const activeStatuses = new Set(["queued", "running", "paused", "canceling"]);
  for (const task of listTasks()) {
    if (task.type !== "download" || !activeStatuses.has(task.status)) continue;
    const metadata = task.metadata ?? {};
    const sameTarget = metadata.target_path === targetPath || (metadata.provider === provider && metadata.repo_id === repoId);
    if (!sameTarget) continue;
    if (task.status === "queued" || await downloadTaskProcessIsActive(task)) return task;
  }
  return undefined;
}

async function downloadTaskProcessIsActive(task: ReturnType<typeof listTasks>[number]): Promise<boolean> {
  const result = await runCommand("ps", ["-eo", "args="], 3000);
  if (!result.ok || !result.stdout) return true;
  const metadata = task.metadata ?? {};
  const tokens = [
    task.command,
    String(metadata.repo_id ?? ""),
    String(metadata.alias ?? "")
  ].filter((token) => token.length > 4);
  return tokens.some((token) => result.stdout.includes(token));
}



async function writePlannedDownloadFiles(provider: string, repoId: string, modelId: string, taskId: string): Promise<number> {
  if (provider !== "huggingface" || !repoId) return 0;
  const files = await fetchHuggingFaceManifest(repoId);
  const now = new Date().toISOString();
  for (const file of files) {
    upsertModelFile({
      model_id: modelId,
      relative_path: file.relative_path,
      status: "planned",
      size_bytes: file.size_bytes,
      downloaded_bytes: 0,
      task_id: taskId,
      error: null,
      updated_at: now
    });
  }
  return files.length;
}

function writeDownloadFileStatus(modelId: string, relativePath: string, status: "downloading" | "downloaded" | "failed" | "canceled", taskId: string, error?: string): void {
  upsertModelFile({
    model_id: modelId,
    relative_path: relativePath,
    status,
    task_id: taskId,
    error: error ?? null,
    updated_at: new Date().toISOString()
  });
}

function runtimeHintsFor(url: string, repoId: string, alias: string) {
  const text = (url + " " + repoId + " " + alias).toLowerCase();
  if (text.includes("gguf")) {
    return [
      { runtime: "lmstudio", status: "external", label: "LM Studio / llama.cpp", reason: "GGUF is not served by the current AMUIN container runtimes." },
      { runtime: "vllm", status: "unsupported", label: "vLLM", reason: "vLLM expects HF checkpoint layouts, not GGUF." },
      { runtime: "trtllm", status: "unsupported", label: "TensorRT-LLM", reason: "TensorRT-LLM needs a checkpoint or converted engine." }
    ];
  }
  if (["whisper", "cosyvoice", "funasr", "fun-asr", "asr", "tts"].some((token) => text.includes(token))) {
    return [
      { runtime: "pytorch", status: "compatible", label: "PyTorch", reason: "Repository name looks like an ASR/TTS model." },
      { runtime: "vllm", status: "unsupported", label: "vLLM", reason: "Audio models are served by the PyTorch runtime." }
    ];
  }
  return [
    { runtime: "vllm", status: "compatible", label: "vLLM", reason: "HF/ModelScope text checkpoints are expected to be loaded by vLLM after config and weights are present." },
    { runtime: "trtllm", status: "possible", label: "TensorRT-LLM", reason: "May require platform/version validation or conversion before serving." },
    { runtime: "pytorch", status: "unsupported", label: "PyTorch", reason: "No ASR/TTS markers detected from the source name." }
  ];
}
