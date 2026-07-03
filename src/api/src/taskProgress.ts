import { access, readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { upsertModelFile } from "./store.js";
import { fetchHuggingFaceTotalBytes } from "./modelManifest.js";
import type { ModelFileRecord, TaskRecord } from "./types.js";

export interface TaskProgressInfo {
  progress_percent: number;
  downloaded_bytes?: number;
  total_bytes?: number;
  target_path?: string;
  complete_on_disk?: boolean;
}


export async function syncDownloadTaskFiles(task: TaskRecord, workspaceRoot: string): Promise<void> {
  if (task.type !== "download") return;
  const modelId = String(task.metadata?.alias ?? task.metadata?.model_id ?? "");
  const targetPath = typeof task.metadata?.target_path === "string" ? resolve(workspaceRoot, task.metadata.target_path) : undefined;
  if (!modelId || !targetPath || !isInside(resolve(workspaceRoot), targetPath)) return;
  const records = await collectDownloadFileRecords(modelId, targetPath, task.id, task.status, task.error);
  for (const record of records) upsertModelFile(record);
}

export async function collectDownloadFileRecords(
  modelId: string,
  targetPath: string,
  taskId: string,
  taskStatus: string,
  error?: string
): Promise<ModelFileRecord[]> {
  const now = new Date().toISOString();
  const finalFiles = await listFileEntries(targetPath, targetPath);
  const tempFiles = await listFileEntries(join(targetPath, ".temp"), join(targetPath, ".temp"));
  const records = new Map<string, ModelFileRecord>();

  for (const file of tempFiles) {
    records.set(file.relative_path, {
      model_id: modelId,
      relative_path: file.relative_path,
      status: taskStatus === "failed" ? "failed" : taskStatus === "canceled" ? "canceled" : "downloading",
      size_bytes: null,
      downloaded_bytes: file.size_bytes,
      task_id: taskId,
      error: taskStatus === "failed" ? error ?? null : null,
      updated_at: now
    });
  }

  const finalStatus = taskStatus === "failed" ? "failed" : taskStatus === "canceled" ? "canceled" : "downloaded";
  for (const file of finalFiles) {
    records.set(file.relative_path, {
      model_id: modelId,
      relative_path: file.relative_path,
      status: finalStatus,
      size_bytes: file.size_bytes,
      downloaded_bytes: file.size_bytes,
      task_id: taskId,
      error: taskStatus === "failed" ? error ?? null : null,
      updated_at: now
    });
  }

  return [...records.values()].filter((record) => !isInternalDownloadFile(record.relative_path));
}

export async function enrichTaskProgress(task: TaskRecord, workspaceRoot: string): Promise<TaskRecord & TaskProgressInfo> {
  const progress = await taskProgress(task, workspaceRoot);
  return { ...task, ...progress };
}

async function taskProgress(task: TaskRecord, workspaceRoot: string): Promise<TaskProgressInfo> {
  const targetPath = typeof task.metadata?.target_path === "string" ? resolve(workspaceRoot, task.metadata.target_path) : undefined;
  const downloadedBytes = targetPath && isInside(resolve(workspaceRoot), targetPath) ? await directorySize(targetPath) : undefined;
  const totalBytes = await expectedTotalBytes(task);
  const completeOnDisk = Boolean(targetPath && await looksCompleteDownloadedModel(targetPath)) || Boolean(totalBytes && downloadedBytes && downloadedBytes >= totalBytes);
  if (task.status === "succeeded") return { progress_percent: 100, downloaded_bytes: downloadedBytes, total_bytes: totalBytes, target_path: targetPath, complete_on_disk: true };
  if (task.status === "failed") return { progress_percent: 100, downloaded_bytes: downloadedBytes, total_bytes: totalBytes, target_path: targetPath, complete_on_disk: completeOnDisk };
  const log = await readFile(task.log_path, "utf-8").catch(() => "");
  const parsed = parseProgress(log);
  const byteProgress = totalBytes && downloadedBytes ? clamp((downloadedBytes / totalBytes) * 100) : undefined;
  const fallback = task.status === "running" ? 5 : task.status === "queued" ? 0 : 0;
  return { progress_percent: completeOnDisk ? 100 : byteProgress ?? parsed ?? fallback, downloaded_bytes: downloadedBytes, total_bytes: totalBytes, target_path: targetPath, complete_on_disk: completeOnDisk };
}

function parseProgress(log: string): number | undefined {
  const clean = log.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r/g, "\n");
  const matches = [...clean.matchAll(/Fetching\s+\d+\s+files:\s+(\d{1,3})%/g)];
  if (matches.length) return clamp(Number(matches[matches.length - 1][1]));
  const generic = [...clean.matchAll(/(?:^|\s)(\d{1,3})%(?:\||\s|$)/g)];
  if (generic.length) return clamp(Number(generic[generic.length - 1][1]));
  return undefined;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

async function directorySize(path: string): Promise<number> {
  try {
    const info = await stat(path);
    if (info.isFile()) return info.size;
    if (!info.isDirectory()) return 0;
    const entries = await readdir(path, { withFileTypes: true });
    const sizes = await Promise.all(entries.map((entry) => directorySize(join(path, entry.name))));
    return sizes.reduce((sum, size) => sum + size, 0);
  } catch {
    return 0;
  }
}


async function listFileEntries(root: string, base: string): Promise<Array<{ relative_path: string; size_bytes: number }>> {
  try {
    const info = await stat(root);
    if (info.isFile()) return [{ relative_path: normalizeRelativePath(relative(base, root) || root.split("/").pop() || root), size_bytes: info.size }];
    if (!info.isDirectory()) return [];
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(entries.map((entry) => listFileEntries(join(root, entry.name), base)));
    return nested.flat();
  } catch {
    return [];
  }
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function isInternalDownloadFile(name: string): boolean {
  return name === "" || name === ".download-complete" || name.endsWith("/.download-complete") || name.split("/").some((part) => part === ".temp");
}

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root + "/");
}

const totalSizeCache = new Map<string, Promise<number | undefined>>();

async function expectedTotalBytes(task: TaskRecord): Promise<number | undefined> {
  if (task.type !== "download") return undefined;
  const repoId = typeof task.metadata?.repo_id === "string" ? task.metadata.repo_id : undefined;
  const provider = String(task.metadata?.provider ?? "");
  if (!repoId || provider !== "huggingface") return undefined;
  if (!totalSizeCache.has(repoId)) totalSizeCache.set(repoId, fetchHuggingFaceTotalBytes(repoId));
  return totalSizeCache.get(repoId);
}

async function looksCompleteDownloadedModel(path: string): Promise<boolean> {
  // Check for explicit completion marker first (most authoritative)
  const hasMarker = await (async () => {
    try { await access(join(path, ".download-complete")); return true; } catch { return false; }
  })();
  if (hasMarker) return true;

  const files = await listFiles(path);
  if (!files.length) return false;
  // Skip .temp directories (in-progress downloads) and .incomplete files
  if (files.some((file) => file.includes(".incomplete"))) return false;
  if (files.some((file) => file.split("/").some((seg) => seg === ".temp"))) return false;
  const names = new Set(files.map((file) => file.split("/").pop() ?? file));
  const hasConfig = names.has("config.json") || names.has("cosyvoice.yaml") || names.has("config.yaml");
  const hasWeight = files.some((file) => /\.(safetensors|bin|gguf|pt|pth|onnx|engine)$/.test(file));
  return hasConfig && hasWeight;
}

async function listFiles(path: string, prefix = ""): Promise<string[]> {
  try {
    const info = await stat(path);
    if (info.isFile()) return [prefix || path];
    if (!info.isDirectory()) return [];
    const entries = await readdir(path, { withFileTypes: true });
    const nested = await Promise.all(entries.map((entry) => listFiles(join(path, entry.name), prefix ? join(prefix, entry.name) : entry.name)));
    return nested.flat();
  } catch {
    return [];
  }
}
