import { compatibilityFor, servicePorts } from "./modelRegistry.js";
import { shellQuote } from "./utils.js";
import type { ContainerSettings, DeploymentRecord, ModelRecord, ServiceType } from "./types.js";

export interface RuntimeLaunchPlan {
  mode: "managed_task";
  env: Record<string, string>;
  command: string;
  working_directory: string;
  notes: string[];
}

export interface RuntimePlanStage {
  id: "prepare" | "pull" | "start" | "health";
  label: string;
  detail: string;
  target?: string;
}

export interface RuntimePlan extends DeploymentRecord {
  compatibility: ReturnType<typeof compatibilityFor>;
  launch: RuntimeLaunchPlan;
  stages: RuntimePlanStage[];
  args: Record<string, unknown>;
}

export interface RuntimeCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function createRuntimePlan(
  deployment: DeploymentRecord,
  model: ModelRecord,
  serviceType: ServiceType,
  openaiModel: string,
  args: Record<string, unknown>,
  baseDir: string,
  settings?: ContainerSettings
): RuntimePlan {
  const resolvedSettings = settingsFor(serviceType, settings);
  const launch = launchPlanFor(serviceType, model.id, openaiModel, args, baseDir, resolvedSettings);
  const baseUrl = publicBaseUrl(serviceType, resolvedSettings.public_port);
  const health = healthUrl(serviceType, resolvedSettings.public_port);

  return {
    ...deployment,
    deployment_id: "plan_" + model.id + "_" + serviceType,
    model_id: model.id,
    status: "planned",
    public_port: resolvedSettings.public_port,
    base_url: baseUrl,
    health_url: health,
    openai_models: [openaiModel],
    compatibility: compatibilityFor(model, serviceType),
    launch,
    stages: stagesFor(serviceType, resolvedSettings, baseUrl, health),
    args
  };
}

export function runtimeCommandFor(
  serviceType: ServiceType,
  modelId: string,
  openaiModel: string,
  args: Record<string, unknown>,
  settings?: ContainerSettings
): RuntimeCommand {
  const resolvedSettings = settingsFor(serviceType, settings);
  if (serviceType === "vllm") {
    return {
      command: "bash",
      args: ["-lc", "echo __AMUIN_STAGE__:prepare:running; docker rm -f vllm-service >/dev/null 2>&1 || true; echo __AMUIN_STAGE__:pull:running; docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.vllm.yml pull vllm-worker; echo __AMUIN_STAGE__:start:running; docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.vllm.yml up -d vllm-worker"],
      env: {
        MODEL_ALIAS: modelId,
        OPENAI_MODEL: openaiModel,
        VLLM_IMAGE: String(args.image ?? resolvedSettings.image ?? process.env.VLLM_IMAGE ?? "vllm/vllm-openai:latest"),
        VLLM_PUBLIC_PORT: String(resolvedSettings.public_port),
        AI_STACK_BIND_ADDR: validBindAddress(process.env.AI_STACK_BIND_ADDR),
        AI_STACK_RESTART_POLICY: resolvedSettings.restart_policy,
        VLLM_MAX_MODEL_LEN: String(args.max_model_len ?? process.env.VLLM_MAX_MODEL_LEN ?? "4096"),
        VLLM_GPU_MEMORY_UTILIZATION: String(args.gpu_memory_utilization ?? process.env.VLLM_GPU_MEMORY_UTILIZATION ?? "0.15"),
        VLLM_MAX_NUM_SEQS: String(args.max_num_seqs ?? process.env.VLLM_MAX_NUM_SEQS ?? "16"),
        VLLM_TENSOR_PARALLEL_SIZE: String(args.tensor_parallel_size ?? process.env.VLLM_TENSOR_PARALLEL_SIZE ?? "1"),
        VLLM_KV_CACHE_DTYPE: String(args.kv_cache_dtype ?? process.env.VLLM_KV_CACHE_DTYPE ?? "auto"),
        VLLM_SWAP_SPACE: String(args.swap_space ?? process.env.VLLM_SWAP_SPACE ?? "4")
      }
    };
  }

  if (serviceType === "pytorch") {
    return {
      command: "bash",
      args: ["-lc", "echo __AMUIN_STAGE__:prepare:running; docker rm -f pytorch-service >/dev/null 2>&1 || true; echo __AMUIN_STAGE__:pull:running; docker compose -f deploy/compose/docker-compose.yml pull pytorch-service; echo __AMUIN_STAGE__:start:running; docker compose -f deploy/compose/docker-compose.yml up -d pytorch-service"],
      env: {
        PYTORCH_PUBLIC_PORT: String(resolvedSettings.public_port),
        PYTORCH_IMAGE: String(args.image ?? resolvedSettings.image ?? process.env.PYTORCH_IMAGE ?? "nvcr.io/nvidia/pytorch:25.04-py3"),
        AI_STACK_RESTART_POLICY: resolvedSettings.restart_policy
      }
    };
  }

  if (serviceType === "trtllm") {
    return {
      command: "bash",
      args: ["-lc", "echo __AMUIN_STAGE__:prepare:running; echo __AMUIN_STAGE__:pull:running; echo __AMUIN_STAGE__:start:running; ops/scripts/start-trtllm-model.sh " + shellQuote(modelId) + " " + shellQuote(String(resolvedSettings.public_port))],
      env: {
        TRTLLM_RESTART_POLICY: resolvedSettings.restart_policy,
        TRTLLM_IMAGE: String(args.image ?? resolvedSettings.image ?? process.env.TRTLLM_IMAGE ?? "nvcr.io/nvidia/tensorrt-llm/release:1.2.0rc6"),
        TRTLLM_MAX_BATCH_SIZE: String(args.max_batch_size ?? process.env.TRTLLM_MAX_BATCH_SIZE ?? "8"),
        TRTLLM_MAX_NUM_TOKENS: String(args.max_num_tokens ?? process.env.TRTLLM_MAX_NUM_TOKENS ?? "4096"),
        TRTLLM_KV_CACHE_FREE_GPU_MEMORY_FRACTION: String(args.kv_cache_free_gpu_memory_fraction ?? process.env.TRTLLM_KV_CACHE_FREE_GPU_MEMORY_FRACTION ?? "0.9"),
        TRTLLM_TP_SIZE: String(args.tp_size ?? process.env.TRTLLM_TP_SIZE ?? "1"),
        TRTLLM_PP_SIZE: String(args.pp_size ?? process.env.TRTLLM_PP_SIZE ?? "1")
      }
    };
  }

  throw new Error("Unsupported deployment service: " + serviceType);
}

export function settingsFor(serviceType: ServiceType, settings?: ContainerSettings): ContainerSettings {
  const fallbackPort = serviceType === "trtllm" ? servicePorts.trtllm : serviceType === "pytorch" ? servicePorts.pytorch : servicePorts.vllm;
  const lazyRuntime = serviceType === "vllm" || serviceType === "trtllm";
  return settings ?? {
    key: serviceType,
    public_port: fallbackPort,
    management_mode: "resident",
    restart_policy: lazyRuntime ? "no" : "unless-stopped",
    auto_restart: !lazyRuntime,
    updated_at: new Date().toISOString()
  };
}

export function publicBaseUrl(serviceType: ServiceType, port: number): string {
  return "http://localhost:" + port + (["vllm", "trtllm"].includes(serviceType) ? "/v1" : "");
}

export function healthUrl(serviceType: ServiceType, port: number): string {
  return "http://localhost:" + port + (serviceType === "pytorch" ? "/healthz" : "/health");
}


function stagesFor(serviceType: ServiceType, settings: ContainerSettings, baseUrl: string, health: string): RuntimePlanStage[] {
  const containerName = serviceType === "vllm" ? "vllm-service" : serviceType === "trtllm" ? "trtllm-service" : "pytorch-service";
  return [
    { id: "prepare", label: "Prepare runtime", detail: "Remove any stale fixed runtime container and apply configured runtime environment.", target: containerName },
    { id: "pull", label: "Pull image", detail: "Pull or verify the runtime image before starting the container.", target: serviceType },
    { id: "start", label: "Start runtime", detail: "Create and start " + serviceType + " on public port " + settings.public_port + ".", target: baseUrl },
    { id: "health", label: "Check health", detail: "Verify the runtime health endpoint before treating the deployment as ready.", target: health }
  ];
}

function launchPlanFor(
  serviceType: ServiceType,
  modelId: string,
  openaiModel: string,
  args: Record<string, unknown>,
  baseDir: string,
  settings: ContainerSettings
): RuntimeLaunchPlan {
  const runnable = runtimeCommandFor(serviceType, modelId, openaiModel, args, settings);
  const env = runnable.env;
  const command = [
    ...Object.entries(env).map(([key, value]) => key + "=" + shellQuote(value)),
    shellQuote(runnable.command),
    ...runnable.args.map(shellQuote)
  ].join(" ");

  return {
    mode: "managed_task",
    env,
    command,
    working_directory: baseDir,
    notes: notesFor(serviceType, settings)
  };
}

function notesFor(serviceType: ServiceType, settings: ContainerSettings): string[] {
  if (serviceType === "vllm") {
    return ["Uses configured public port " + settings.public_port + " and serves OpenAI traffic at /v1."];
  }
  if (serviceType === "pytorch") {
    return ["PyTorch service serves audio models (Whisper, FunASR, CosyVoice)."];
  }
  if (serviceType === "trtllm") {
    return ["TensorRT-LLM remains an advanced route; validate checkpoint support before starting."];
  }
  return [];
}

function validBindAddress(value: string | undefined): string {
  return value === "127.0.0.1" || value === "0.0.0.0" ? value : "0.0.0.0";
}
