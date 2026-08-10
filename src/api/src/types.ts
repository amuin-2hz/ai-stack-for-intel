export type CompatibilityStatus = "compatible" | "possible" | "needs_conversion" | "unsupported";
export type ServiceType = "chat" | "vision" | "asr" | "tts" | "embedding" | "rerank" | "vllm" | "trtllm" | "pytorch" | "lmstudio";
export type EngineType = "chat" | "vision" | "asr" | "tts" | "embedding" | "rerank";
export type EngineDevice = "NPU" | "GPU" | "CPU";

export interface CompatibilityInfo {
  status: CompatibilityStatus;
  reason: string;
}

export type ModelFileStatus = "planned" | "downloading" | "downloaded" | "failed" | "canceled";

export interface ModelFileRecord {
  model_id: string;
  relative_path: string;
  status: ModelFileStatus;
  size_bytes?: number | null;
  downloaded_bytes?: number | null;
  task_id?: string | null;
  error?: string | null;
  updated_at: string;
}

export type ModelAuditSeverity = "info" | "warning" | "error";

export interface ModelAuditIssue {
  code: string;
  severity: ModelAuditSeverity;
  message: string;
}

export interface ModelRuntimeRecommendation {
  runtime: string;
  status: CompatibilityStatus | "external";
  reason: string;
}

export interface ModelGpuMemoryAudit {
  status: "fits" | "tight" | "insufficient" | "unknown";
  required_bytes?: number | null;
  available_bytes?: number | null;
  total_bytes?: number | null;
  reason: string;
}

export interface ModelRecord {
  id: string;
  display_name: string;
  source: {
    provider: string;
    repo_id: string | null;
    original_url: string | null;
  };
  local: {
    path: string;
    layout: string;
    format: string;
    size_bytes: number;
    file_count: number;
    weight_files: number;
    config_files: string[];
    incomplete_files: string[];
  };
  capabilities: string[];
  runtime: {
    preferred: string;
    supported: string[];
  };
  inference: {
    context_length: {
      min: number;
      max: number;
      default: number;
      step: number;
      source: string;
    };
  };
  compatibility: Record<string, CompatibilityInfo>;
  audit: {
    issues: ModelAuditIssue[];
    recommendations: ModelRuntimeRecommendation[];
    gpu_memory: ModelGpuMemoryAudit;
  };
  status: {
    download: string;
    deploy: string;
    health: string;
  };
  serving: {
    service_type: string | null;
    public_base_url: string | null;
    worker_endpoint: string | null;
    openai_model: string | null;
  };
}

export interface DeploymentRecord {
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
}

export interface ChatMessage {
  type: "HumanMessage" | "AssistantMessage" | "ToolMessage";
  content: string;
}

export interface ChatRecord {
  id: string;
  name: string;
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
}

export interface WorkbenchState {
  current_chat_id: string;
  selected_model: string;
  selected_sources: string[];
  chats: Record<string, ChatRecord>;
  ingest_tasks: Record<string, string>;
  tasks?: Record<string, TaskRecord>;
  deployments?: Record<string, ActiveDeploymentRecord>;
  network?: NetworkSettings;
  container_settings?: Record<string, ContainerSettings>;
  engine_settings?: Record<string, EngineSettings>;
  workbench?: WorkbenchSettings;
}

export interface RepairAction {
  action: string;
  label: string;
  detail?: string;
}

export interface TaskDiagnostic {
  category: string;
  severity: "info" | "warning" | "error";
  stage?: "prepare" | "pull" | "start" | "health" | "download" | "launch" | "unknown";
  message: string;
  repair_actions: RepairAction[];
}

export type TaskStatus = "queued" | "running" | "paused" | "canceling" | "canceled" | "succeeded" | "failed";
export type TaskType = "download" | "deploy" | "container";

export interface TaskRecord {
  id: string;
  type: TaskType;
  status: TaskStatus;
  command: string;
  cwd: string;
  log_path: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  started_at?: string;
  finished_at?: string;
  exit_code?: number | null;
  error?: string;
  diagnostic?: TaskDiagnostic;
}

export interface ActiveDeploymentRecord {
  deployment_id: string;
  model_id: string;
  service_type: ServiceType;
  runtime: string;
  container_name: string | null;
  public_port: number;
  base_url: string;
  health_url: string;
  worker_endpoint: string;
  openai_model: string;
  status: string;
  task_id?: string;
  updated_at: string;
}

export interface WorkbenchSettings {
  management_port: number;
  active_management_port: number;
  requires_restart: boolean;
  updated_at: string;
}

export interface NetworkSettings {
  lan_access_enabled: boolean;
  desired_bind_address: string;
  active_bind_address: string;
  requires_restart: boolean;
  updated_at: string;
}

export type ContainerManagementMode = "resident" | "once";
export type ContainerRestartPolicy = "no" | "unless-stopped" | "always" | "on-failure";

export interface ContainerSettings {
  key: string;
  public_port: number;
  management_mode: ContainerManagementMode;
  restart_policy: ContainerRestartPolicy;
  auto_restart: boolean;
  image?: string;
  components?: string[];
  is_default?: boolean;
  updated_at: string;
}

/** Engine settings for the LocalRuntime inference engines */
export interface EngineSettings {
  key: string;
  type: EngineType;
  device: EngineDevice;
  port: number;
  auto_start: boolean;
  updated_at: string;
}
