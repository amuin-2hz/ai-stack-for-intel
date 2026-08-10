/**
 * Thin facade — re-exports engine management for backward compatibility.
 * Legacy container-based imports now route to the engineManager subprocess system.
 */

// Re-export engine presets as container presets
export type { EngineRecord as ContainerRecord, EnginePreset as RuntimePreset } from "./engineManager.js";
export { enginePresets as presets, presetForModel } from "./engineManager.js";

export { presetForKey } from "./containerPresets.js";

export function isModelPublishingContainer(name: string): boolean {
  const prefixes = ["chat_", "vision_", "asr_", "tts_", "embedding_", "rerank_"];
  return prefixes.some((p) => name.startsWith(p));
}

export const hiddenContainerNames = new Set<string>();
export const modelRuntimePrefixes = ["chat_", "vision_", "asr_", "tts_", "embedding_", "rerank_"];

// ── Re-export engine management ──
export {
  listEngines as listContainers,
  startEngine,
  stopEngine,
  engineHealth
} from "./engineManager.js";

// ── Thin wrappers for backward compat ──
export async function containerAction(_name: string, _action: string) {
  return { ok: false, detail: "Container actions are not supported; use engine start/stop endpoints." };
}

export async function containerLogs(_name: string) {
  return { name: _name, logs: "Container logging not available; use engine task logs." };
}

export async function deleteContainer(key: string) {
  return { key, ok: false, steps: [`Engine runtime "${key}" management is handled via /engines endpoints.`] };
}

export async function applyContainerRuntimeConfig(_key: string, _settings: any) {
  return { applied: true, detail: "Runtime configuration is managed through engine endpoints." };
}

export { createCustomContainerTask, createImagePullTask, createImageTestTask, createRuntimeStartTestTask } from "./containerTasks.js";
