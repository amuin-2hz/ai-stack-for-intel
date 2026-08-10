import { access, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { isWeightFile, runCommand, safeSize, slugify } from "./utils.js";
import { deleteModelFiles } from "./store.js";
import type { CompatibilityInfo, ModelAuditIssue, ModelGpuMemoryAudit, ModelRuntimeRecommendation, DeploymentRecord, ModelRecord, ServiceType } from "./types.js";
import {
  resolveStrategy, detectCapabilities as detectCaps, compatibilityForModel,
  type FormatMatchParams,
} from "./modelFormatStrategies.js";

/* ── constants ─────────────────────────────────── */
const configNames = new Set(["config.json", "tokenizer.json", "tokenizer_config.json", "configuration.json", "config.yaml", "cosyvoice.yaml"]);

export const servicePorts = {
  vllm: Number(process.env.VLLM_PUBLIC_PORT ?? "30000"),
  trtllm: Number(process.env.TRTLLM_PUBLIC_PORT ?? "31000"),
  pytorch: Number(process.env.PYTORCH_PUBLIC_PORT ?? process.env.AUDIO_PUBLIC_PORT ?? "32000")
};

/* ── model listing ─────────────────────────────── */
export async function listModels(modelsRoot: string): Promise<ModelRecord[]> {
  try { await access(modelsRoot); } catch { return []; }
  const entries = await readdir(modelsRoot, { withFileTypes: true });
  const records: ModelRecord[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const path = join(modelsRoot, entry.name);
    if (entry.isDirectory() || (entry.isFile() && isWeightFile(path))) {
      records.push(await auditModelPath(path, await gpuMemoryInfo()));
    }
  }
  return records;
}

export async function getModel(modelsRoot: string, modelId: string): Promise<ModelRecord | undefined> {
  return (await listModels(modelsRoot)).find((model) => model.id === modelId);
}

export async function deleteModel(modelsRoot: string, modelId: string): Promise<{ model_id: string; deleted_path: string }> {
  const model = await getModel(modelsRoot, modelId);
  if (!model) throw new Error("Unknown model: " + modelId);
  const root = resolve(modelsRoot);
  const target = resolve(model.local.path);
  if (target !== root && !target.startsWith(root + "/")) {
    throw new Error("Refusing to delete a path outside models root.");
  }
  await removeModelPath(target);
  deleteModelFiles(modelId);
  return { model_id: modelId, deleted_path: target };
}

async function removeModelPath(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
}

/* ── service model fetch ───────────────────────── */
async function fetchServiceModels(port: number): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`http://localhost:${port}/v1/models`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return [];
    const payload = await response.json() as { data?: Array<{ id: string }> };
    return (payload.data ?? []).map((m) => m.id);
  } catch { return []; }
}

function modelIsServedBy(diskModelId: string, serviceModelIds: string[]): boolean {
  const normalized = diskModelId.toLowerCase().replace(/[-_]/g, "");
  if (!normalized) return false;
  return serviceModelIds.some((serviceId) => {
    const svcNormalized = serviceId.toLowerCase().replace(/[-_/]/g, "");
    return normalized.includes(svcNormalized) || svcNormalized.includes(normalized);
  });
}

export async function isModelPublished(modelId: string): Promise<{ published: boolean; service_type?: string }> {
  const pytorchModels = await fetchServiceModels(servicePorts.pytorch);
  if (modelIsServedBy(modelId, pytorchModels)) return { published: true, service_type: "pytorch" };
  return { published: false };
}

/* ── deployments ───────────────────────────────── */
export async function listDeployments(_modelsRoot: string): Promise<DeploymentRecord[]> {
  const engineTypes = ["chat", "vision", "asr", "tts", "embedding", "rerank"];
  const portMap: Record<string, number> = { chat: 31000, vision: 31001, asr: 31002, tts: 31003, embedding: 31004, rerank: 31005 };

  return engineTypes.map((type) => ({
    deployment_id: `svc_${type}`,
    model_id: null,
    status: "configured",
    service_type: type,
    runtime: type,
    container_name: null,
    public_port: portMap[type] ?? 31000,
    base_url: `http://localhost:${portMap[type] ?? 31000}`,
    health_url: `http://localhost:${portMap[type] ?? 31000}/health`,
    worker_endpoint: null,
    openai_models: [],
    warnings: [`${type} engine is idle until started via /engines/${type}/start.`]
  }));
}

export function compatibilityFor(model: ModelRecord, serviceType: ServiceType): CompatibilityInfo {
  return model.compatibility[serviceType] ?? { status: "unsupported", reason: `Unknown service type: ${serviceType}.` };
}

/* ── URL parsing ───────────────────────────────── */
export function parseModelSource(url: string, alias?: string, provider = "auto"): Record<string, string | null> {
  const parsed = parseUrl(url);
  let inferredProvider = provider;
  let repoId: string | null = null;

  if (provider === "auto") {
    if (parsed.hostname === "modelscope.cn") inferredProvider = "modelscope";
    else if (parsed.hostname === "huggingface.co" || parsed.protocol === "hf:") inferredProvider = "huggingface";
    else inferredProvider = url.includes("/") ? "huggingface" : "unknown";
  }

  if (inferredProvider === "modelscope") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    repoId = parts[0] === "models" ? parts.slice(1).slice(0, 2).join("/") : parts.slice(0, 2).join("/") || null;
  } else if (inferredProvider === "huggingface") {
    const parts = parsed.protocol === "hf:" ? `${parsed.hostname}${parsed.pathname}`.split("/").filter(Boolean) : parsed.pathname.split("/").filter(Boolean);
    repoId = parts.slice(0, 2).join("/") || (url.includes("/") ? url.replace(/^https?:\/\/huggingface\.co\//, "") : null);
  }

  const suggestedAlias = alias || slugify((repoId || url).split("/").pop() || "model");
  return { provider: inferredProvider, repo_id: repoId, alias: suggestedAlias, target_path: `models/${suggestedAlias}`, original_url: url };
}

/* ── model audit ───────────────────────────────── */
async function auditModelPath(path: string, gpuMemory: GpuMemoryInfo): Promise<ModelRecord> {
  const rootStat = await stat(path);
  const files = rootStat.isFile() ? [path] : await walkFiles(path);
  const names = new Set(files.map((file) => basename(file)));
  const weightFiles = files.filter(isWeightFile);
  const incompleteFiles = files.filter((file) => basename(file).includes(".incomplete"));
  const configs = [...names].filter((name) => configNames.has(name)).sort();
  const config = rootStat.isDirectory() ? await readJson(join(path, "config.json")) : {};
  const tokenizerConfig = rootStat.isDirectory() ? await readJson(join(path, "tokenizer_config.json")) : {};
  const inference = inferInferenceLimits(config, tokenizerConfig);

  // Detect in-progress .temp download staging
  const hasTempDir = rootStat.isDirectory() ? await (async () => {
    try { await access(join(path, ".temp")); return true; } catch { return false; }
  })() : false;

  const params: FormatMatchParams = { path, isFile: rootStat.isFile(), files, names, configs, config, tokenizerConfig };
  const strategy = resolveStrategy(params);
  const capabilities = detectCaps(params);

  const format = strategy.name;

  const download = hasTempDir ? "incomplete" : downloadStatusFor(format, weightFiles.length, configs, incompleteFiles.length);
  const sizeBytes = (await Promise.all(files.map(safeSize))).reduce((sum, size) => sum + size, 0);
  const basePath = rootStat.isDirectory() ? path : join(path, "..");

  const compatibility = compatibilityForModel(format, capabilities, params);
  const audit = auditForModel(format, capabilities, configs, weightFiles.length, incompleteFiles.length, hasTempDir, compatibility, sizeBytes, gpuMemory);

  return {
    id: slugify(rootStat.isFile() ? basename(path, extname(path)) : basename(path)),
    display_name: rootStat.isFile() ? basename(path, extname(path)) : basename(path),
    source: { provider: "local", repo_id: null, original_url: null },
    local: {
      path,
      layout: strategy.name,
      format,
      size_bytes: sizeBytes,
      file_count: files.length,
      weight_files: weightFiles.length,
      config_files: configs,
      incomplete_files: incompleteFiles.slice(0, 20).map((file) => relative(basePath, file))
    },
    capabilities,
    runtime: strategy.runtime,
    inference,
    compatibility,
    audit,
    status: { download, deploy: "stopped", health: "unknown" },
    serving: { service_type: null, public_base_url: null, worker_endpoint: null, openai_model: null }
  };
}

/* ── helpers ───────────────────────────────────── */
async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    // Skip .temp staging directories used during downloads
    if (entry.name === ".temp") continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}


function auditForModel(
  format: string,
  capabilities: string[],
  configs: string[],
  weightFileCount: number,
  incompleteFileCount: number,
  hasTempDir: boolean,
  compatibility: Record<string, CompatibilityInfo>,
  sizeBytes: number,
  gpuMemory: GpuMemoryInfo
): { issues: ModelAuditIssue[]; recommendations: ModelRuntimeRecommendation[]; gpu_memory: ModelGpuMemoryAudit } {
  const issues: ModelAuditIssue[] = [];
  if (hasTempDir) issues.push({ code: "download_staging_present", severity: "warning", message: "Download staging directory is present; wait for the download task to finish or cancel and retry." });
  if (incompleteFileCount > 0) issues.push({ code: "incomplete_files", severity: "error", message: "Incomplete files were found in the model directory." });
  if (["hf_safetensors", "hf_bin", "hf_partial"].includes(format) && !configs.includes("config.json")) {
    issues.push({ code: "missing_config", severity: "error", message: "config.json is missing; vLLM and TensorRT-LLM need model config metadata." });
  }
  if (["hf_safetensors", "hf_bin", "hf_partial", "audio", "trtllm_engine"].includes(format) && weightFileCount === 0) {
    issues.push({ code: "missing_weights", severity: "error", message: "No weight or engine files were found." });
  }
  if (format === "unknown") issues.push({ code: "unknown_layout", severity: "warning", message: "Model layout is not recognized; inspect files before deployment." });
  if (capabilities.includes("unknown")) issues.push({ code: "unknown_capability", severity: "info", message: "Model capability could not be inferred from config or file names." });
  if (capabilities.includes("chat") && compatibility.chat?.status === "possible") {
    issues.push({ code: "chat_template_unverified", severity: "warning", message: "Text generation is available, but no chat/instruct template was detected; use an instruct/chat model for agent workloads." });
  }
  const gpu_memory = gpuMemoryAudit(format, sizeBytes, gpuMemory);
  if (gpu_memory.status === "insufficient") issues.push({ code: "gpu_memory_insufficient", severity: "warning", message: gpu_memory.reason });
  if (gpu_memory.status === "tight") issues.push({ code: "gpu_memory_tight", severity: "info", message: gpu_memory.reason });

  const recommendations = Object.entries(compatibility)
    .filter(([runtime, info]) => runtime !== "lmstudio" || info.status === "compatible")
    .map(([runtime, info]) => ({ runtime, status: info.status, reason: info.reason }))
    .sort((a, b) => recommendationRank(a.status) - recommendationRank(b.status));
  return { issues, recommendations, gpu_memory };
}

type GpuMemoryInfo = { available: boolean; totalBytes?: number; usedBytes?: number; freeBytes?: number; detail?: string };

let gpuMemoryInfoCache: Promise<GpuMemoryInfo> | undefined;

function gpuMemoryInfo(): Promise<GpuMemoryInfo> {
  gpuMemoryInfoCache ??= inspectGpuMemoryInfo();
  return gpuMemoryInfoCache;
}

async function inspectGpuMemoryInfo(): Promise<GpuMemoryInfo> {
  // Use totalmem/freemem from OS as a rough estimate for LocalRuntime
  // OpenVINO models run on system RAM, not dedicated GPU memory
  const { totalmem, freemem } = await import("node:os");
  const totalBytes = totalmem();
  const freeBytes = freemem();
  return {
    available: true,
    totalBytes,
    usedBytes: totalBytes - freeBytes,
    freeBytes,
    detail: "System memory (OpenVINO models use shared system RAM)"
  };
}

function gpuMemoryAudit(format: string, sizeBytes: number, gpuMemory: GpuMemoryInfo): ModelGpuMemoryAudit {
  if (!gpuMemory.available) return { status: "unknown", required_bytes: null, available_bytes: null, total_bytes: null, reason: gpuMemory.detail ?? "GPU memory information is unavailable." };
  if (format === "gguf") return { status: "unknown", required_bytes: null, available_bytes: gpuMemory.freeBytes ?? null, total_bytes: gpuMemory.totalBytes ?? null, reason: "GGUF is handled by an external runtime; AMUIN cannot estimate its GPU fit here." };
  const requiredBytes = estimateRuntimeMemoryBytes(format, sizeBytes);
  if (!requiredBytes) return { status: "unknown", required_bytes: null, available_bytes: gpuMemory.freeBytes ?? null, total_bytes: gpuMemory.totalBytes ?? null, reason: "Runtime memory requirement cannot be estimated for this layout." };
  const freeBytes = gpuMemory.freeBytes ?? 0;
  if (freeBytes >= requiredBytes * 1.2) return { status: "fits", required_bytes: requiredBytes, available_bytes: freeBytes, total_bytes: gpuMemory.totalBytes ?? null, reason: "Estimated runtime memory fits available GPU memory." };
  if (freeBytes >= requiredBytes) return { status: "tight", required_bytes: requiredBytes, available_bytes: freeBytes, total_bytes: gpuMemory.totalBytes ?? null, reason: "Estimated runtime memory is close to available GPU memory; lower context length or GPU memory utilization may be needed." };
  return { status: "insufficient", required_bytes: requiredBytes, available_bytes: freeBytes, total_bytes: gpuMemory.totalBytes ?? null, reason: "Estimated runtime memory exceeds currently available GPU memory." };
}

function estimateRuntimeMemoryBytes(format: string, sizeBytes: number): number | undefined {
  if (!sizeBytes) return undefined;
  if (["hf_safetensors", "hf_bin", "hf_partial"].includes(format)) return Math.ceil(sizeBytes * 1.35 + 2 * 1024 ** 3);
  if (format === "trtllm_engine") return Math.ceil(sizeBytes * 1.15 + 1 * 1024 ** 3);
  if (format === "audio") return Math.ceil(sizeBytes * 1.2 + 1 * 1024 ** 3);
  if (format === "openvino_ir") return Math.ceil(sizeBytes * 1.5);  // OV IR loads fully into memory
  return undefined;
}

function recommendationRank(status: string): number {
  if (status === "compatible") return 0;
  if (status === "possible") return 1;
  if (status === "needs_conversion" || status === "external") return 2;
  return 3;
}

function downloadStatusFor(format: string, weightFileCount: number, configs: string[], incompleteFileCount: number): string {
  if (incompleteFileCount > 0) return "incomplete";
  if (format === "gguf") return "unsupported";
  if (format === "trtllm_engine") return weightFileCount > 0 ? "ready" : "needs_review";
  if (format === "audio") return weightFileCount > 0 ? "ready" : "needs_review";
  if (format === "openvino_ir") return weightFileCount > 0 ? "ready" : "needs_review";
  if (["hf_safetensors", "hf_bin", "hf_partial"].includes(format)) return weightFileCount > 0 && configs.includes("config.json") ? "ready" : "needs_review";
  return "needs_review";
}

function inferInferenceLimits(config: Record<string, unknown>, tokenizerConfig: Record<string, unknown>) {
  const candidates: Array<[string, unknown]> = [
    ["config.max_position_embeddings", config.max_position_embeddings],
    ["config.model_max_length", config.model_max_length],
    ["config.seq_length", config.seq_length],
    ["config.n_positions", config.n_positions],
    ["config.n_ctx", config.n_ctx],
    ["config.max_sequence_length", config.max_sequence_length],
    ["config.max_seq_len", config.max_seq_len],
    ["tokenizer_config.model_max_length", tokenizerConfig.model_max_length],
    ["tokenizer_config.max_len", tokenizerConfig.max_len]
  ];
  const found = candidates
    .map(([source, value]) => ({ source, value: Number(value) }))
    .find((item) => Number.isFinite(item.value) && item.value > 0 && item.value < 10_000_000);
  const max = Math.max(512, Math.floor(found?.value ?? 4096));
  const step = max >= 8192 ? 1024 : 512;
  return { context_length: { min: 512, max, default: Math.min(max, 4096), step, source: found?.source ?? "default" } };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try { return JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>; } catch { return {}; }
}

function parseUrl(value: string): URL {
  try { return new URL(value.includes("://") ? value : `hf://${value}`); } catch { return new URL(`hf://${value}`); }
}
