/**
 * Engine presets — adapted for LocalRuntime.
 * These are the inference engine definitions that replace Docker container presets.
 */

import type { EnginePreset } from "./engineManager.js";
import { enginePresets } from "./engineManager.js";
import type { ContainerSettings } from "./types.js";

/* ── re-export engine presets ────────────────────── */
export type { EnginePreset as RuntimePreset };
export { enginePresets as presets };

export function presetForKey(key: string): EnginePreset | undefined {
  return enginePresets.find((p) => p.type === key);
}

export const hiddenContainerNames = new Set<string>();
export const modelRuntimePrefixes = ["chat_", "vision_", "asr_", "tts_", "embedding_", "rerank_"];

export function isModelPublishingContainer(name: string): boolean {
  return modelRuntimePrefixes.some((p) => name.startsWith(p));
}

export function defaultSettingsFor(key: string, _port: number, _mode: string): ContainerSettings {
  return {
    key,
    public_port: _port,
    management_mode: "resident",
    restart_policy: "no",
    auto_restart: false,
    updated_at: new Date().toISOString()
  };
}

/* ── backward compat types ───────────────────────── */
export interface ContainerRecord {
  key: string;
  name: string;
  slot_name: string;
  instance_name: string | null;
  title: string;
  image: string;
  status: string;
  state: "running" | "stopped" | "missing" | "unknown";
  ports: string;
  public_port: number;
  runtime: string;
  management_mode: "resident" | "once";
  restart_policy: "no" | "unless-stopped" | "always" | "on-failure";
  auto_restart: boolean;
  preset: boolean;
  components: string[];
  official_image: string;
  image_pulled: boolean;
  test_status: "untested" | "running" | "passed" | "failed";
  software_versions: Record<string, string>;
}

export interface CustomContainerRequest {
  name?: string;
  image?: string;
  components?: string[];
  compose_yaml?: string;
  management_mode?: "resident" | "once";
  restart_policy?: "no" | "unless-stopped" | "always" | "on-failure";
  auto_restart?: boolean;
}
