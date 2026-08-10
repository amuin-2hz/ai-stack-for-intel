/**
 * Model format strategies — extended with OpenVINO detection.
 * Recognizes OpenVINO IR (.xml + .bin), PyTorch, GGUF, etc.
 */

import type { CompatibilityInfo, ServiceType } from "./types.js";

/* ── format detector interface ────────────────────── */
export interface FormatStrategy {
  name: string;
  matches(params: FormatMatchParams): boolean;
  runtime: { preferred: string; supported: string[] };
  compatibility: Record<string, CompatibilityInfo>;
}

export interface FormatMatchParams {
  path: string;
  isFile: boolean;
  files: string[];
  names: Set<string>;
  configs: string[];
  config: Record<string, unknown>;
  tokenizerConfig?: Record<string, unknown>;
}

/* ── detection helpers ────────────────────────────── */
function looksLikeAudio(path: string, names: Set<string>): boolean {
  const lower = path.toLowerCase().replace(/[/\\]/g, "").split("/").pop() ?? "";
  return ["whisper", "fun-asr", "funasr", "cosyvoice", "kokoro", "qwen3-asr", "qwen3-tts", "asr", "tts"].some(
    (token) => lower.includes(token)
  ) || ["cosyvoice.yaml", "vocabulary.txt", "spk2info.pt", "kokoro.yaml"].some((name) => names.has(name));
}

function audioCapabilities(path: string, names: Set<string>, config: Record<string, unknown>): string[] {
  if (!looksLikeAudio(path, names)) return [];
  const lower = path.toLowerCase();
  if (lower.includes("tts") || lower.includes("kokoro") || lower.includes("cosyvoice")) return ["tts"];
  if (lower.includes("asr") || lower.includes("whisper")) return ["asr"];
  return ["asr"]; // default
}

/* ── strategy implementations ─────────────────────── */
export const formatStrategies: FormatStrategy[] = [
  // ── OpenVINO IR format (new) ──
  {
    name: "openvino_ir",
    matches: ({ files, names }) =>
      files.some((f) => f.endsWith(".xml")) &&
      files.some((f) => f.endsWith(".bin")) &&
      (names.has("openvino_model.xml") || names.has("config.json") || files.some((f) => f.endsWith(".xml") && f.endsWith(".bin") === false)),
    runtime: { preferred: "openvino", supported: ["openvino", "pytorch"] },
    compatibility: {
      vllm: { status: "unsupported", reason: "OpenVINO IR models run on NPU/GPU/CPU via OpenVINO, not vLLM." },
      trtllm: { status: "unsupported", reason: "OpenVINO IR models run on NPU/GPU/CPU via OpenVINO, not TensorRT-LLM." },
      pytorch: { status: "possible", reason: "OpenVINO IR model detected; use OpenVINO subprocess engine for best performance." },
      lmstudio: { status: "unsupported", reason: "OpenVINO IR models run via OpenVINO, not LM Studio." }
    }
  },
  // ── GGUF ──
  {
    name: "gguf",
    matches: ({ isFile, files }) =>
      (isFile && files.length === 1 && files[0]?.endsWith?.(".gguf")) ||
      files.some((f) => f.endsWith(".gguf")),
    runtime: { preferred: "lmstudio", supported: ["lmstudio"] },
    compatibility: {
      vllm: { status: "unsupported", reason: "GGUF is a llama.cpp/LM Studio format, not served by this workbench." },
      trtllm: { status: "unsupported", reason: "TensorRT-LLM needs a checkpoint or converted engine, not GGUF." },
      pytorch: { status: "unsupported", reason: "GGUF is not an ASR/TTS model directory." },
      lmstudio: { status: "compatible", reason: "GGUF is best managed by LM Studio or llama.cpp." }
    }
  },
  // ── TRT-LLM engine ──
  {
    name: "trtllm_engine",
    matches: ({ files }) => files.some((f) => f.endsWith(".engine")),
    runtime: { preferred: "trtllm", supported: ["trtllm"] },
    compatibility: {
      vllm: { status: "unsupported", reason: "TensorRT-LLM engines cannot be loaded by vLLM." },
      trtllm: { status: "compatible", reason: "Converted engine layout is intended for TensorRT-LLM." },
      pytorch: { status: "unsupported", reason: "Engine is not an ASR/TTS model directory." },
      lmstudio: { status: "unsupported", reason: "Engine is not a GGUF file." }
    }
  },
  // ── audio ──
  {
    name: "audio",
    matches: ({ path, names }) => looksLikeAudio(path, names),
    runtime: { preferred: "openvino", supported: ["openvino", "pytorch"] },
    compatibility: {
      vllm: { status: "unsupported", reason: "Audio models use ASR/TTS-specific files and are not vLLM checkpoints." },
      trtllm: { status: "unsupported", reason: "Audio models run on NPU/CPU via OpenVINO, not TensorRT-LLM." },
      pytorch: { status: "compatible", reason: "Directory matches the ASR/TTS model layout; use OpenVINO engine." },
      lmstudio: { status: "unsupported", reason: "Audio service directories are not GGUF files." }
    }
  },
  // ── HF safetensors ──
  {
    name: "hf_safetensors",
    matches: ({ files }) => files.some((f) => f.endsWith(".safetensors")),
    runtime: { preferred: "openvino", supported: ["openvino", "pytorch"] },
    compatibility: {
      vllm: { status: "unsupported", reason: "HF checkpoints should be converted to OpenVINO IR for local inference." },
      trtllm: { status: "unsupported", reason: "HF checkpoints should be converted to OpenVINO IR for local inference." },
      pytorch: { status: "possible", reason: "HF snapshot can be loaded with PyTorch fallback; better with OpenVINO." },
      lmstudio: { status: "unsupported", reason: "HF checkpoints are not GGUF files." }
    }
  },
  // ── HF bin ──
  {
    name: "hf_bin",
    matches: ({ files, configs }) => files.some((f) => f.endsWith(".bin")) && configs.length > 0,
    runtime: { preferred: "openvino", supported: ["openvino", "pytorch"] },
    compatibility: {
      vllm: { status: "unsupported", reason: "Bin checkpoints should be converted to OpenVINO IR for local inference." },
      trtllm: { status: "unsupported", reason: "Bin checkpoints should be converted to OpenVINO IR for local inference." },
      pytorch: { status: "possible", reason: "Bin checkpoint detected; OpenVINO conversion recommended." },
      lmstudio: { status: "unsupported", reason: "HF checkpoints are not GGUF files." }
    }
  },
  // ── HF partial ──
  {
    name: "hf_partial",
    matches: ({ configs }) => configs.includes("config.json"),
    runtime: { preferred: "openvino", supported: ["openvino", "pytorch"] },
    compatibility: {
      vllm: { status: "unsupported", reason: "Partial HF snapshot; convert to OpenVINO IR for local inference." },
      trtllm: { status: "unsupported", reason: "Partial HF snapshot; convert to OpenVINO IR for local inference." },
      pytorch: { status: "possible", reason: "Partial HF snapshot; OpenVINO conversion recommended for best performance." },
      lmstudio: { status: "unsupported", reason: "HF checkpoints are not GGUF files." }
    }
  }
];

/* ── default strategy ─────────────────────────────── */
export const defaultStrategy: FormatStrategy = {
  name: "unknown",
  matches: () => true,
  runtime: { preferred: "manual_review", supported: [] },
  compatibility: {
    vllm: { status: "unsupported", reason: "Unrecognized model layout." },
    trtllm: { status: "unsupported", reason: "Unrecognized model layout." },
    pytorch: { status: "possible", reason: "Unrecognized layout; manual review needed." },
    lmstudio: { status: "unsupported", reason: "No GGUF file was found." }
  }
};

/* ── dispatch ──────────────────────────────────────── */
export function resolveStrategy(params: FormatMatchParams): FormatStrategy {
  return formatStrategies.find((s) => s.matches(params)) ?? defaultStrategy;
}

/* ── capability detection ─────────────────────────── */
export function detectCapabilities(params: FormatMatchParams): string[] {
  const { path, config, names } = params;

  const audioCaps = audioCapabilities(path, names, config);
  if (audioCaps.length) return audioCaps;

  const lower = path.toLowerCase();
  const architectures = Array.isArray(config.architectures)
    ? config.architectures.map(String).join(" ").toLowerCase()
    : "";
  const modelType = String(config.model_type ?? "").toLowerCase();

  if (lower.includes("rerank") || lower.includes("reranker") || architectures.includes("reranker"))
    return ["rerank"];

  if (lower.includes("embed") || architectures.includes("embedding") ||
    (modelType.includes("bert") && !architectures.includes("causallm")))
    return ["embedding"];

  if (["vl", "vision", "multimodal", "qwen2_5_vl", "llava"].some(
    (t) => lower.includes(t) || modelType.includes(t) || architectures.includes(t)
  )) return ["chat", "vision"];

  if (architectures.includes("causallm") || modelType ||
    architectures.includes("llama") || architectures.includes("gpt") ||
    architectures.includes("qwen") || architectures.includes("mistral") ||
    architectures.includes("chatglm") || architectures.includes("baichuan"))
    return ["chat"];

  return ["unknown"];
}

/* ── compatibility map ────────────────────────────── */
/* ── OpenVINO engine compatibility ───────────────────
 * Each model capability maps to a LocalRuntime engine type.
 * Only pre-converted OpenVINO IR models can run on Intel NPU/GPU.
 */
export function compatibilityForModel(
  format: string,
  capabilities: string[],
  params?: FormatMatchParams
): Record<string, CompatibilityInfo> {
  const engines = ["chat", "vision", "asr", "tts", "embedding", "rerank"] as const;
  const result: Record<string, CompatibilityInfo> = {};
  const chatInstructionReady = hasChatInstructionSignal(params);
  const experimentalQwen3Asr = hasExperimentalQwen3AsrLayout(params);

  for (const engine of engines) {
    if (!capabilities.includes(engine)) {
      result[engine] = { status: "unsupported", reason: `Model does not support ${engine}.` };
      continue;
    }

    if (engine === "chat" && !chatInstructionReady) {
      result[engine] = {
        status: "possible",
        reason: "Text-generation model detected, but no chat/instruct template was found; it can run raw generation, but is not agent-ready."
      };
      continue;
    }

    if (engine === "asr" && experimentalQwen3Asr) {
      result[engine] = {
        status: "compatible",
        reason: "Qwen3-ASR thinker layout is supported through the isolated OpenVINO helper runtime."
      };
      continue;
    }

    result[engine] = { status: "compatible", reason: `Model supports ${engine} inference via OpenVINO.` };
  }

  return result;
}

function hasExperimentalQwen3AsrLayout(params?: FormatMatchParams): boolean {
  if (!params) return false;
  return params.files.some((file) => file.replace(/\\/g, "/").endsWith("thinker/openvino_thinker_language_model.xml"));
}

function hasChatInstructionSignal(params?: FormatMatchParams): boolean {
  if (!params) return false;
  if (params.names.has("chat_template.jinja")) return true;
  const chatTemplate = params.tokenizerConfig?.chat_template;
  if (typeof chatTemplate === "string" && chatTemplate.trim()) return true;
  if (Array.isArray(chatTemplate) && chatTemplate.length > 0) return true;

  const modelName = params.path.replace(/\\/g, "/").split("/").pop() ?? params.path;
  const haystack = [
    modelName,
    params.config._name_or_path,
    params.config.name_or_path,
    params.config.model_name,
    params.tokenizerConfig?._name_or_path,
    params.tokenizerConfig?.name_or_path
  ].map((value) => String(value ?? "").toLowerCase()).join(" ");

  return /(^|[-_/.\s])(instruct|chat|assistant|it)([-_/.\s]|$)/.test(haystack);
}
