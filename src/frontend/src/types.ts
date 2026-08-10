export type View = 'home' | 'chat' | 'models' | 'engines' | 'settings';
// Legacy View values for backward compatibility during migration
export type LegacyView = View | 'dashboard' | 'load' | 'running' | 'playground' | 'services' | 'deploy' | 'tasks';
export type Locale = 'zh-CN' | 'en-US';
export type ThemeMode = 'light' | 'dark';
export type ServiceType = 'chat' | 'vision' | 'asr' | 'tts' | 'embedding' | 'rerank' | 'vllm' | 'trtllm' | 'pytorch';

// Legacy container record for backward compat during migration
export interface ContainerRecord {
  key: string;
  name: string;
  slot_name?: string;
  instance_name?: string | null;
  title: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  public_port?: number;
  runtime: string;
  management_mode: string;
  restart_policy?: string;
  auto_restart?: boolean;
  preset: boolean;
  components: string[];
  official_image?: string;
  image_pulled?: boolean;
  test_status?: string;
  software_versions?: Record<string, string>;
}

/* ── inference engine types ─────────────────────── */
export type EngineType = 'chat' | 'vision' | 'asr' | 'tts' | 'embedding' | 'rerank';
export type EngineDevice = 'NPU' | 'GPU' | 'CPU';
export type EngineStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface EnginePreset {
  type: EngineType;
  title: string;
  script: string;
  default_port: number;
  default_device: EngineDevice;
  default_model: string;
  model_keywords: string[];
  components: string[];
}

export interface EngineRecord {
  key: string;           // 'chat' | 'vision' | 'asr' | 'tts' | 'embedding' | 'rerank'
  type: EngineType;
  name: string;
  title: string;
  port: number;
  device: EngineDevice;
  status: EngineStatus;
  state: string;         // 'running' | 'stopped' | 'starting' | 'error' | 'missing'
  model_name?: string;
  model_id?: string;
  management_mode: string;
  restart_policy?: string;
  auto_restart?: boolean;
  preset: boolean;
  error?: string;
}

/* ── model types ─────────────────────────────────── */
export type CompatInfo = { status: string; reason: string };
export type ModelAuditIssue = { code: string; severity: string; message: string };
export type ModelRuntimeRecommendation = { runtime: string; status: string; reason: string };
export type ModelGpuMemoryAudit = { status: string; required_bytes?: number | null; available_bytes?: number | null; total_bytes?: number | null; reason: string };

export interface ModelRecord {
  id: string;
  display_name: string;
  local: {
    path: string;
    format: string;
    size_bytes: number;
    file_count: number;
    weight_files?: number;
    config_files?: string[];
    incomplete_files?: string[];
  };
  runtime: { preferred: string; supported: string[] };
  inference?: {
    context_length?: { min: number; max: number; default: number; step: number; source: string };
  };
  compatibility: Record<string, CompatInfo>;
  audit?: {
    issues: ModelAuditIssue[];
    recommendations: ModelRuntimeRecommendation[];
    gpu_memory?: ModelGpuMemoryAudit;
  };
  status: { download: string; deploy: string; health: string };
}

/* ── deployment types ────────────────────────────── */
export interface DeploymentRecord {
  deployment_id: string;
  model_id?: string | null;
  status: string;
  service_type: string;
  runtime: string;
  container_name?: string;
  public_port: number;
  base_url: string;
  health_url: string;
  openai_models: string[];
  warnings: string[];
}

/* ── task types ──────────────────────────────────── */
export type RuntimeHint = { runtime: string; status: string; label: string; reason: string };
export type RuntimePlanStage = { id: string; label: string; detail: string; target?: string };
export type TaskRuntimePlanStageStatus = 'pending' | 'running' | 'succeeded' | 'failed';
export type TaskRuntimePlan = {
  deployment_id?: string;
  base_url?: string;
  health_url?: string;
  stages?: RuntimePlanStage[];
  current_stage?: string;
  stage_statuses?: Record<string, TaskRuntimePlanStageStatus>;
};

export type ModelFileRecord = {
  model_id: string;
  relative_path: string;
  status: string;
  size_bytes?: number | null;
  downloaded_bytes?: number | null;
  task_id?: string | null;
  error?: string | null;
  updated_at: string;
};

export type TaskDiagnostic = {
  category: string;
  severity: string;
  stage?: string;
  message: string;
  repair_actions: Array<{ action: string; label: string; detail?: string }>;
};

export interface TaskRecord {
  id: string;
  type: string;
  status: string;
  command: string;
  cwd: string;
  log_path: string;
  metadata: Record<string, unknown> & { runtime_plan?: TaskRuntimePlan };
  created_at: string;
  updated_at: string;
  started_at?: string;
  finished_at?: string;
  error?: string;
  progress_percent?: number;
  downloaded_bytes?: number;
  target_path?: string;
  model_files?: ModelFileRecord[];
  diagnostic?: TaskDiagnostic;
}

/* ── import / download types ─────────────────────── */
export interface ImportPreview {
  model?: { provider?: string; repo_id?: string; target_path?: string };
  runtime_hints?: RuntimeHint[];
  download?: { command?: string };
  message?: string;
}

/* ── system / device types ───────────────────────── */
export interface DeviceInfo {
  hostname?: string;
  vendor?: string;
  model?: string;
  os?: { name?: string; kernel?: string; arch?: string; version?: string; build?: string };
  cpu?: { model?: string; cores?: number };
  memory?: { total_bytes?: number; free_bytes?: number };
  storage?: { available?: boolean; volumes?: Array<{ mount: string; total_bytes: number; used_bytes: number; free_bytes: number; used_percent: number }> };
  gpu?: { available?: boolean; detail?: string; devices?: Array<Record<string, unknown>> };
  devices?: { NPU?: boolean; GPU?: boolean; CPU?: boolean };
}

export interface SystemCheck {
  management_url: string;
  configured_management_url?: string;
  backend_url: string;
  lan_addresses?: string[];
  workbench?: WorkbenchSettings;
  service_ports?: Record<string, { port: number; available: boolean }>;
  openvino?: { ok: boolean; version?: string; devices?: string[]; installed?: boolean };
  engines?: { running: number; total: number };
  status?: { uptime_seconds?: number; load_average?: number[]; cpu_load_percent?: number };
  device?: DeviceInfo;
  network?: NetworkSettings;
}

export interface NetworkSettings {
  lan_access_enabled: boolean;
  desired_bind_address: string;
  active_bind_address: string;
  requires_restart: boolean;
  updated_at: string;
}

export interface WorkbenchSettings {
  management_port: number;
  active_management_port: number;
  requires_restart: boolean;
  updated_at: string;
}

/* ── chat types ──────────────────────────────────── */
export interface Conversation {
  id: string;
  title: string;
  modelId: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}
