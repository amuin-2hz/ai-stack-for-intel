/**
 * Deployment helpers — adapted for LocalRuntime engine management.
 * Docker containers are replaced by Python subprocess engines.
 */

import type { EngineRecord } from "./engineManager.js";
import { listEngines, enginePresets, engineHealth } from "./engineManager.js";
import type { ActiveDeploymentRecord } from "./types.js";
import { listActiveDeployments, getActiveDeployment, deleteDeployment } from "./store.js";

/* ── types ────────────────────────────────────────── */
export type ConfiguredDeployment = {
  deployment_id: string;
  model_id: string | null;
  status: string;
  service_type: string;
  runtime: string;
  container_name: string | null;
  public_port: number;
  base_url: string;
  health_url: string;
  worker_endpoint: string | null;
  openai_models: string[];
  warnings: string[];
};

export interface DeploymentHelpersDeps {
  modelsRoot: string;
  audioServiceUrl: string;
}

export function createDeploymentHelpers(deps: DeploymentHelpersDeps) {
  const { audioServiceUrl } = deps;

  async function configuredDeployments(): Promise<ConfiguredDeployment[]> {
    return enginePresets.map((preset) => ({
      deployment_id: `svc_${preset.type}`,
      model_id: null,
      status: "configured",
      service_type: preset.type,
      runtime: preset.type,
      container_name: null,
      public_port: preset.default_port,
      base_url: `http://localhost:${preset.default_port}`,
      health_url: `http://localhost:${preset.default_port}/health`,
      worker_endpoint: `http://127.0.0.1:${preset.default_port}`,
      openai_models: [],
      warnings: [`${preset.title} engine is idle until started via /engines/${preset.type}/start.`]
    }));
  }

  function normalizeDeployment<T extends { service_type?: string; public_port?: number }>(deployment: T): T {
    return deployment;
  }

  async function liveActiveDeployments(): Promise<ActiveDeploymentRecord[]> {
    const engines = listEngines();
    const active: ActiveDeploymentRecord[] = [];
    const now = new Date().toISOString();

    for (const engine of engines) {
      if (engine.status !== "running") continue;

      const health = await engineHealth(engine);
      if (!health.healthy) {
        // Stale — remove from persisted deployments
        const persisted = listActiveDeployments().filter(
          (d) => d.deployment_id === `svc_${engine.type}`
        );
        for (const p of persisted) deleteDeployment(p.deployment_id);
        continue;
      }

      active.push({
        deployment_id: `svc_${engine.type}`,
        model_id: engine.model_id,
        service_type: engine.type as any,
        runtime: engine.type,
        container_name: null,
        public_port: engine.port,
        base_url: `http://localhost:${engine.port}`,
        health_url: `http://localhost:${engine.port}/health`,
        worker_endpoint: `http://127.0.0.1:${engine.port}`,
        openai_model: engine.model_name,
        status: "running",
        task_id: undefined,
        updated_at: now
      });
    }

    return active;
  }

  function mergeDeployments(
    configured: ConfiguredDeployment[],
    active: ActiveDeploymentRecord[]
  ): ConfiguredDeployment[] {
    const byId = new Map<string, ConfiguredDeployment>(
      configured.map((d) => [d.deployment_id, d])
    );
    for (const a of active) {
      const existing = byId.get(a.deployment_id);
      if (existing) {
        existing.status = a.status;
        existing.model_id = a.model_id;
        existing.openai_models = [a.openai_model];
      }
    }
    return [...byId.values()];
  }

  async function deploymentContainerIsRunning(_containerName: string | null): Promise<boolean> {
    return false; // No containers — engines are subprocesses
  }

  async function findDeployment(deploymentId: string) {
    const active = getActiveDeployment(deploymentId);
    if (active) return active;
    return (await configuredDeployments()).find((d) => d.deployment_id === deploymentId);
  }

  function runtimeHealthUrl(serviceType: string): string {
    const preset = enginePresets.find((p) => p.type === serviceType);
    return preset ? `http://127.0.0.1:${preset.default_port}/health` : audioServiceUrl + "/healthz";
  }

  function runtimeOpenAiBaseUrl(serviceType: string): string | null {
    const preset = enginePresets.find((p) => p.type === serviceType);
    if (!preset) return null;
    return `http://127.0.0.1:${preset.default_port}/v1`;
  }

  return {
    configuredDeployments,
    findDeployment,
    liveActiveDeployments,
    normalizeDeployment,
    mergeDeployments,
    deploymentContainerIsRunning,
    runtimeHealthUrl,
    runtimeOpenAiBaseUrl
  };
}
