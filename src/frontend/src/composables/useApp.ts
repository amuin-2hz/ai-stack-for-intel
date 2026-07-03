import { computed, ref } from 'vue';
import { message, Modal } from 'ant-design-vue';
import { apiUrl } from './apiBase';
import type {
  Locale, ThemeMode, View, ServiceType, ModelRecord, DeploymentRecord, TaskRecord,
  ContainerRecord, ImportPreview, SystemCheck, NetworkSettings, WorkbenchSettings, RuntimeHint
} from '../types';
import { messages, statusCopy } from '../locales';

/* ── reactive state ──────────────────────────── */
export const locale = ref<Locale>((localStorage.getItem('locale') as Locale) || 'zh-CN');
export const themeMode = ref<ThemeMode>((localStorage.getItem('themeMode') as ThemeMode) || 'light');
export const view = ref<View>('models');

export const models = ref<ModelRecord[]>([]);
export const deployments = ref<DeploymentRecord[]>([]);
export const tasks = ref<TaskRecord[]>([]);
export const containers = ref<ContainerRecord[]>([]);
export const system = ref<SystemCheck | null>(null);
export const network = ref<NetworkSettings | null>(null);
export const workbenchSettings = ref<WorkbenchSettings | null>(null);
export const managementPort = ref(8888);

export const modelUrl = ref('');
export const importMessage = ref('');
export const importPreview = ref<ImportPreview | null>(null);

export const deployModelId = ref('');
export const selectedContainerKey = ref('chat');
export const selectedTaskId = ref('');
export const selectedDownloadLogId = ref('');
export const selectedLogContainer = ref('');
export const taskLog = ref('');
export const containerLog = ref('');
export const networkMessage = ref('');

export const customComponents = ref<string[]>(['pytorch']);
export const customMode = ref('resident');
export const customRestartPolicy = ref('unless-stopped');
export const customAutoRestart = ref(true);
export const customName = ref('');
export const customImage = ref('nvcr.io/nvidia/pytorch:25.04-py3');
export const customModalOpen = ref(false);
export const customTab = ref<'components' | 'compose'>('components');
export const composeYaml = ref('');
export const composeValidating = ref(false);
export const composeValidationResult = ref<{ valid: boolean; errors?: string; normalized?: string } | null>(null);
export const logCollapsed = ref(true);
export const modelListDrawerOpen = ref(false);
export const rightPanelCollapsed = ref(false);

export const deployOpenAiModel = ref('');
export const deployContextLength = ref(4096);
export const deployGpuUtil = ref(15);
export const deployMaxSeqs = ref(16);
export const deployTensorParallel = ref(1);
export const deployKvCacheDtype = ref('auto');
export const deploySwapSpace = ref(4);
export const trtMaxBatchSize = ref(8);
export const trtMaxNumTokens = ref(4096);
export const trtKvCacheFraction = ref(0.9);
export const trtTpSize = ref(1);
export const trtPpSize = ref(1);

/* ── i18n helpers ─────────────────────────────── */
export function t(key: string): string {
  return (messages[locale.value] as Record<string, string>)[key] ?? key;
}

export function statusText(status: string): string {
  return statusCopy[locale.value][status] ?? status;
}

/* ── computed ─────────────────────────────────── */
export const readyModelList = computed(() => models.value.filter((model) => model.status.download === 'ready'));
export const modelLibraryList = computed(() => readyModelList.value);
export const readyModels = computed(() => readyModelList.value.length);
export const runtimeContainers = computed(() => containers.value.filter((item) => item.runtime !== 'custom'));
export const runningServices = computed(() => containers.value.filter((item) => item.state === 'running').length);
export const runningDeployments = computed(() => deployments.value.filter((item) => item.status === 'running' || item.openai_models.length));

const taskRank = (status: string) => status === 'running' || status === 'queued' || status === 'paused' || status === 'canceling' ? 0 : status === 'failed' || status === 'canceled' ? 1 : status === 'succeeded' ? 3 : 2;
const taskTime = (task: TaskRecord) => task.updated_at || task.started_at || task.created_at || '';

export const visibleTasks = computed(() => {
  const seen = new Set<string>();
  return [...tasks.value]
    .sort((a, b) => taskRank(a.status) - taskRank(b.status) || b.created_at.localeCompare(a.created_at))
    .filter((task) => {
      if (task.type !== 'deploy' || task.status !== 'succeeded') return true;
      const key = ['deploy', task.metadata?.model_id, task.metadata?.service_type, task.metadata?.openai_model].join(':');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
});

export const dashboardTasks = computed(() => visibleTasks.value);
export const activeTasks = computed(() => tasks.value.filter((task) => ['queued', 'running', 'paused', 'canceling'].includes(task.status)));
export const downloadTasks = computed(() => tasks.value
  .filter((task) => task.type === 'download' && ['queued', 'running', 'paused', 'canceling'].includes(task.status))
  .sort((a, b) => taskTime(b).localeCompare(taskTime(a)))
);
export const customContainers = computed(() => containers.value.filter((c) => c.runtime === 'custom'));
export const composePlaceholder = computed(() => locale.value === 'zh-CN'
  ? `services:\n  my-service:\n    image: nvidia/cuda:12.4.0-runtime-ubuntu22.04\n    ports:\n      - "33000:8000"\n    command: sleep infinity`
  : `services:\n  my-service:\n    image: nvidia/cuda:12.4.0-runtime-ubuntu22.04\n    ports:\n      - "33000:8000"\n    command: sleep infinity`
);

export const selectedContainer = computed(() => containers.value.find((item) => item.key === selectedContainerKey.value) ?? containers.value[0]);
export const selectedTask = computed(() => tasks.value.find((item) => item.id === selectedTaskId.value));
const memoryUsed = computed(() => Math.max(0, (system.value?.device?.memory?.total_bytes ?? 0) - (system.value?.device?.memory?.free_bytes ?? 0)));
export const memoryPercent = computed(() => percent(memoryUsed.value, system.value?.device?.memory?.total_bytes ?? 0));
export const cpuPercent = computed(() => Math.round(system.value?.status?.cpu_load_percent ?? 0));
const storageVolume = computed(() => system.value?.device?.storage?.volumes?.[0]);
export const storagePercent = computed(() => Math.round(storageVolume.value?.used_percent ?? 0));
export const gpuSummary = computed(() => {
  const openvinoDevices = system.value?.openvino?.devices;
  if (Array.isArray(openvinoDevices) && openvinoDevices.length) {
    return openvinoDevices.join(' / ');
  }
  const devices = system.value?.device?.gpu?.devices ?? [];
  if (!system.value?.device?.gpu?.available) return system.value?.device?.gpu?.detail ?? t('unavailable');
  return devices.map((device) => String(device.name ?? device.id ?? 'NVIDIA GPU')).join(', ') || 'NVIDIA';
});
export const portRows = computed(() => Object.entries(system.value?.service_ports ?? {}).map(([name, info]) => ({ name, ...info })));
export const selectedDeployModel = computed(() => models.value.find((item) => item.id === deployModelId.value));
export const containerOptions = computed(() => {
  const model = selectedDeployModel.value;
  const allowed = model ? new Set((INFERENCE_SERVICES as ServiceType[]).filter((service) => model.compatibility[service]?.status !== 'unsupported')) : null;
  return containers.value
    .filter((item) => item.runtime !== 'custom' && (!allowed || allowed.has(item.runtime as ServiceType)))
    .map((item) => ({ label: item.title + ' · ' + (item.state === 'missing' ? containerStateText(item) : item.name), value: item.key }));
});
export const modelOptions = computed(() => readyModelList.value.map((model) => ({ label: model.display_name, value: model.id })));
export const selectedDeployment = computed(() => {
  const container = selectedContainer.value;
  if (!container) return undefined;
  const modelId = deployModelId.value;
  const byModel = runningDeployments.value.find((item) => item.service_type === container.runtime && (!modelId || item.model_id === modelId || item.openai_models.includes(modelId)));
  return byModel ?? runningDeployments.value.find((item) => item.service_type === container.runtime);
});
export const activeInferenceDeployments = computed(() => runningDeployments.value);
export const activeContainerCount = computed(() => runtimeContainers.value.filter((item) => item.state === 'running').length);
export const servingModelCount = computed(() => runningDeployments.value.length);
export const createdContainerCount = computed(() => runtimeContainers.value.length);
export const managementHost = computed(() => {
  if (!network.value?.lan_access_enabled) return 'localhost';
  const lanAddr = system.value?.lan_addresses?.[0];
  if (lanAddr) return lanAddr;
  const host = window.location.hostname || '';
  if (host && !['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host)) return host;
  return host || 'localhost';
});
export const consoleAddress = computed(() => 'http://' + managementHost.value + ':' + (workbenchSettings.value?.active_management_port ?? 8888));
export const modelListSummaryUrl = computed(() => runningDeployments.value[0] ? modelEndpoint(runningDeployments.value[0]) : 'http://' + publicHost.value + ':30000/v1/models');
export const publishedModelRows = computed(() => runningDeployments.value.flatMap((deployment) => {
  const names = deployment.openai_models.length ? deployment.openai_models : [deployment.runtime];
  return names.map((name) => ({
    key: deployment.deployment_id + ':' + name,
    model_name: name,
    address: publicBaseUrl(deployment),
    call_id: name
  }));
}));
export const publicHost = computed(() => {
  if (network.value?.lan_access_enabled) {
    const lanAddr = system.value?.lan_addresses?.[0];
    if (lanAddr) return lanAddr;
  }
  const host = window.location.hostname || 'localhost';
  if (host && !['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host)) return host;
  return system.value?.lan_addresses?.[0] || host || 'localhost';
});
const gpuCount = computed(() => Math.max(1, system.value?.device?.gpu?.devices?.length ?? 1));
export const contextLimit = computed(() => selectedDeployModel.value?.inference?.context_length ?? { min: 512, max: 4096, default: 4096, step: 512, source: 'default' });
export const tensorParallelLimit = computed(() => Math.max(1, Math.min(16, gpuCount.value)));

/* ── pure helpers ──────────────────────────────── */
export function percent(used: number, total: number) { return total ? Math.round((used / total) * 100) : 0; }
export function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
export function formatDuration(seconds = 0) { const days = Math.floor(seconds / 86400); const hours = Math.floor((seconds % 86400) / 3600); const minutes = Math.floor((seconds % 3600) / 60); return days ? days + 'd ' + hours + 'h' : hours + 'h ' + minutes + 'm'; }
export function formatBytes(value: number) { if (!value) return '0 B'; const units = ['B', 'KB', 'MB', 'GB', 'TB']; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); return (value / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1) + ' ' + units[index]; }
export function badgeColor(status: string) { if (['compatible', 'ready', 'configured', 'running', 'succeeded'].includes(status)) return 'green'; if (['unsupported', 'incomplete', 'failed', 'missing', 'stopped', 'canceled', 'error'].includes(status)) return 'red'; if (['paused', 'canceling', 'starting'].includes(status)) return 'blue'; return 'gold'; }
export function shortModelPath(path: string) { const marker = '/models/'; const index = path.lastIndexOf(marker); return index >= 0 ? '…' + path.slice(index) : path; }

const INFERENCE_SERVICES: ServiceType[] = ['chat', 'vision', 'asr', 'tts'];

export function publicBaseUrl(deployment: DeploymentRecord) { const suffix = INFERENCE_SERVICES.includes(deployment.service_type as ServiceType) ? '/v1' : ''; return 'http://' + publicHost.value + ':' + deployment.public_port + suffix; }
export function modelEndpoint(deployment: DeploymentRecord) { return publicBaseUrl(deployment) + '/models'; }
export function chatEndpoint(deployment: DeploymentRecord) { return publicBaseUrl(deployment) + '/chat/completions'; }

export function supportedContainers(model: ModelRecord, containerList: ContainerRecord[]) {
  return (INFERENCE_SERVICES as ServiceType[])
    .filter((service) => model.compatibility[service]?.status !== 'unsupported')
    .map((service) => ({ service, container: containerList.find((item) => item.runtime === service) }));
}

export function containerStateText(container: ContainerRecord): string {
  return INFERENCE_SERVICES.includes(container.runtime as ServiceType) && container.state === 'missing' ? t('disabled') : statusText(container.state);
}

export function containerStateColor(container: ContainerRecord): string {
  return INFERENCE_SERVICES.includes(container.runtime as ServiceType) && container.state === 'missing' ? 'gold' : badgeColor(container.state);
}

export function modelStatusHelp(model: ModelRecord): string {
  if (model.status.download === 'needs_review') return t('needsReviewHelp');
  if (model.status.download === 'unsupported') return t('unsupportedHelp');
  if (model.status.download === 'incomplete') return t('incompleteHelp');
  return '';
}

export function modelAuditSummary(model: ModelRecord): string {
  const issue = model.audit?.issues?.find((item) => item.severity === 'error') ?? model.audit?.issues?.[0];
  const recommendation = model.audit?.recommendations?.find((item) => item.status === 'compatible') ?? model.audit?.recommendations?.[0];
  const memory = model.audit?.gpu_memory;
  if (issue) return issue.message;
  if (memory && ['tight', 'insufficient'].includes(memory.status)) return memory.reason;
  if (recommendation) return recommendation.runtime + ': ' + recommendation.reason;
  return '';
}

export function taskProgress(task: TaskRecord): number {
  if (typeof task.progress_percent === 'number') return task.progress_percent;
  if (task.status === 'succeeded') return 100;
  if (task.status === 'failed' || task.status === 'canceled') return 100;
  if (task.status === 'running') return 5;
  if (task.status === 'queued') return 0;
  return 0;
}

export function taskTypeText(type: string): string { return t('task' + type.slice(0, 1).toUpperCase() + type.slice(1)); }
export function runtimeHintColor(status: string): string { if (status === 'compatible') return 'green'; if (status === 'possible' || status === 'external') return 'gold'; return 'red'; }
export function taskAlias(task: TaskRecord): string { return String(task.metadata?.alias ?? task.metadata?.model_name ?? task.metadata?.model_id ?? task.metadata?.repo_id ?? task.id); }
export function taskRuntimeHints(task: TaskRecord): RuntimeHint[] { const hints = task.metadata?.runtime_hints; return Array.isArray(hints) ? hints as RuntimeHint[] : []; }
export function taskRuntimePlanStages(task: TaskRecord) {
  const stages = task.metadata?.runtime_plan?.stages;
  return Array.isArray(stages) ? stages : [];
}
export function taskRuntimePlanStageStatus(task: TaskRecord, stageId: string): string {
  return task.metadata?.runtime_plan?.stage_statuses?.[stageId] ?? (task.metadata?.runtime_plan?.current_stage === stageId ? 'running' : 'pending');
}
export function taskRuntimePlanStageColor(task: TaskRecord, stageId: string): string {
  const status = taskRuntimePlanStageStatus(task, stageId);
  if (status === 'succeeded') return 'green';
  if (status === 'running') return 'blue';
  if (status === 'failed') return 'red';
  return 'default';
}
export function taskRuntimePlanSummary(task: TaskRecord): string {
  const plan = task.metadata?.runtime_plan;
  if (!plan) return '';
  const stages = taskRuntimePlanStages(task);
  const currentStage = String(plan.current_stage ?? '');
  const current = currentStage ? stages.find((stage) => stage.id === currentStage) : undefined;
  const stageText = current ? current.label + ': ' + statusText(taskRuntimePlanStageStatus(task, current.id)) : stages.length ? stages.map((stage) => stage.label).join(' / ') : '';
  const target = String(plan.base_url ?? plan.health_url ?? '');
  return [stageText, target].filter(Boolean).join(' · ');
}
export function taskTarget(task: TaskRecord): string { return String(task.metadata?.target_path ?? task.cwd); }

export function taskFileSummary(task: TaskRecord): string {
  const files = task.model_files ?? [];
  if (!files.length) return '';
  const counts = files.reduce<Record<string, number>>((acc, file) => {
    acc[file.status] = (acc[file.status] ?? 0) + 1;
    return acc;
  }, {});
  const order = ['downloading', 'downloaded', 'failed', 'canceled', 'planned'];
  return order.filter((status) => counts[status]).map((status) => statusText(status) + ' ' + counts[status]).join(' · ');
}


function taskFileDetailLines(task: TaskRecord, limit = 6): string[] {
  const files = task.model_files ?? [];
  if (!files.length) return [];
  const head = files.slice(0, limit).map((file) => {
    const size = typeof file.downloaded_bytes === 'number' && file.downloaded_bytes > 0 ? ' · ' + formatBytes(file.downloaded_bytes) : '';
    return '  - ' + file.relative_path + ' · ' + statusText(file.status) + size;
  });
  if (files.length > limit) head.push('  ... +' + (files.length - limit));
  return head;
}

export function taskSummary(task: TaskRecord): string {
  if (task.diagnostic) return [task.diagnostic.stage ? t('stage') + ': ' + task.diagnostic.stage : '', task.diagnostic.message, task.diagnostic.repair_actions.map((action) => action.label).slice(0, 2).join(' / ')].filter(Boolean).join(' · ');
  if (task.type === 'download') return [t('modelName') + ': ' + taskAlias(task), t('source') + ': ' + String(task.metadata?.repo_id ?? task.metadata?.provider ?? '-'), t('downloadTarget') + ': ' + shortModelPath(taskTarget(task))].join(' · ');
  if (task.type === 'deploy') return [t('modelName') + ': ' + String(task.metadata?.model_id ?? '-'), t('container') + ': ' + String(task.metadata?.service_type ?? '-'), taskRuntimePlanSummary(task)].filter(Boolean).join(' · ');
  if (task.type === 'container') {
    const action = String(task.metadata?.action ?? '');
    const engine = String(task.metadata?.engine_type ?? task.metadata?.name ?? '-').toUpperCase();
    const model = String(task.metadata?.model_name ?? task.metadata?.model_id ?? '-');
    const device = String(task.metadata?.device ?? '-');
    const port = String(task.metadata?.port ?? '-');
    if (action === 'start' || action === 'stop') {
      const actionText = action === 'start' ? t('start') : t('stop');
      return [actionText + ': ' + engine, t('modelName') + ': ' + model, 'Device: ' + device, t('port') + ': ' + port].join(' · ');
    }
    return t('containerName') + ': ' + String(task.metadata?.name ?? '-') + ' · ' + t('image') + ': ' + String(task.metadata?.image ?? '-');
  }
  return task.command;
}

export function formatTaskEventTime(value?: string): string {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function taskEventLog(task?: TaskRecord): string {
  if (!task) return t('noTaskEvents');
  const alias = taskAlias(task);
  const lines: string[] = [];
  if (task.type === 'download') {
    lines.push(formatTaskEventTime(task.created_at) + ' ' + t('eventDownloadStarted') + '：' + alias);
    const progress = taskProgress(task);
    if (task.status === 'running') lines.push(formatTaskEventTime(task.updated_at) + ' ' + t('eventDownloading') + '：' + alias + ' · ' + progress + '% · ' + formatBytes(task.downloaded_bytes ?? 0));
    else if (task.status === 'paused') lines.push(formatTaskEventTime(task.updated_at) + ' ' + t('eventDownloadPaused') + '：' + alias);
    else if (task.status === 'queued') lines.push(formatTaskEventTime(task.updated_at) + ' ' + t('eventDownloadQueued') + '：' + alias);
    else if (task.status === 'canceling') lines.push(formatTaskEventTime(task.updated_at) + ' ' + t('eventDownloadStopping') + '：' + alias);
    else if (task.status === 'canceled' || task.status === 'failed') lines.push(formatTaskEventTime(task.updated_at) + ' ' + t('eventDownloadStopped') + '：' + alias);
    else if (task.status === 'succeeded') lines.push(formatTaskEventTime(task.finished_at ?? task.updated_at) + ' ' + t('eventDownloadCompleted') + '：' + alias);
    lines.push(t('downloadTarget') + '：' + shortModelPath(taskTarget(task)));
    const fileSummary = taskFileSummary(task);
    if (fileSummary) {
      lines.push(t('files') + '：' + fileSummary);
      lines.push(...taskFileDetailLines(task));
    }
    return lines.join('\n');
  }
  lines.push(formatTaskEventTime(task.created_at) + ' ' + taskTypeText(task.type) + '：' + taskAlias(task));
  if (task.type === 'container' && (task.metadata?.action === 'start' || task.metadata?.action === 'stop')) {
    lines.push(taskSummary(task));
  }
  if (task.type === 'deploy') {
    const plan = task.metadata?.runtime_plan;
    lines.push(t('modelName') + '：' + String(task.metadata?.model_id ?? '-'));
    lines.push(t('container') + '：' + String(task.metadata?.service_type ?? '-'));
    if (plan?.base_url) lines.push(t('apiAddress') + '：' + plan.base_url);
    if (plan?.health_url) lines.push('Health：' + plan.health_url);
    const stages = taskRuntimePlanStages(task);
    if (stages.length) lines.push(t('stage') + '：' + stages.map((stage) => stage.label + '(' + statusText(taskRuntimePlanStageStatus(task, stage.id)) + ')').join(' -> '));
  }
  lines.push(formatTaskEventTime(task.updated_at) + ' ' + statusText(task.status));
  if (task.diagnostic) lines.push(task.diagnostic.message);
  return lines.join('\n');
}


export function downloadEventTimeline(taskList = tasks.value): string[] {
  const events = taskList
    .filter((task) => task.type === 'download')
    .flatMap((task) => {
      const alias = taskAlias(task);
      const rows: Array<{ at: string; text: string }> = [
        { at: task.created_at, text: formatTaskEventTime(task.created_at) + ' ' + t('eventDownloadStarted') + '：' + alias }
      ];
      if (task.status === 'queued') rows.push({ at: task.updated_at, text: formatTaskEventTime(task.updated_at) + ' ' + t('eventDownloadQueued') + '：' + alias });
      if (task.status === 'running') rows.push({ at: task.updated_at, text: formatTaskEventTime(task.updated_at) + ' ' + t('eventDownloading') + '：' + alias + ' · ' + taskProgress(task) + '% · ' + formatBytes(task.downloaded_bytes ?? 0) });
      if (task.status === 'paused') rows.push({ at: task.updated_at, text: formatTaskEventTime(task.updated_at) + ' ' + t('eventDownloadPaused') + '：' + alias });
      if (task.status === 'canceling') rows.push({ at: task.updated_at, text: formatTaskEventTime(task.updated_at) + ' ' + t('eventDownloadStopping') + '：' + alias });
      if (task.status === 'canceled' || task.status === 'failed') rows.push({ at: task.updated_at, text: formatTaskEventTime(task.updated_at) + ' ' + t('eventDownloadStopped') + '：' + alias });
      if (task.status === 'succeeded') rows.push({ at: task.finished_at ?? task.updated_at, text: formatTaskEventTime(task.finished_at ?? task.updated_at) + ' ' + t('eventDownloadCompleted') + '：' + alias });
      return rows;
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((event) => event.text);
  return events.length ? events : [t('noTaskEvents')];
}


export function isModelBusy(model: ModelRecord): boolean {
  return activeTasks.value.some((task) => task.metadata?.model_id === model.id || task.metadata?.alias === model.id || task.metadata?.alias === model.display_name);
}

export function canDeleteModel(model: ModelRecord): boolean {
  const deployed = runningDeployments.value.some((deployment) => deployment.model_id === model.id || deployment.openai_models.includes(model.id));
  return !deployed && !isModelBusy(model) && !['running', 'starting'].includes(model.status.deploy);
}

export function deploymentArgs() {
  return { max_model_len: deployContextLength.value, gpu_memory_utilization: deployGpuUtil.value / 100, max_num_seqs: deployMaxSeqs.value, tensor_parallel_size: deployTensorParallel.value, kv_cache_dtype: deployKvCacheDtype.value, max_batch_size: trtMaxBatchSize.value, max_num_tokens: trtMaxNumTokens.value, kv_cache_free_gpu_memory_fraction: trtKvCacheFraction.value, tp_size: trtTpSize.value, pp_size: trtPpSize.value };
}

export function compatibilityRows(model: ModelRecord) {
  return (INFERENCE_SERVICES as ServiceType[])
    .map((service) => ({ service, info: model.compatibility[service] }))
    .filter((item) => item.info);
}

export function clampDeployParamsForModel() {
  const limit = contextLimit.value;
  deployContextLength.value = clamp(deployContextLength.value || limit.default, limit.min, limit.max);
  deployTensorParallel.value = clamp(deployTensorParallel.value || 1, 1, tensorParallelLimit.value);
  trtMaxNumTokens.value = clamp(trtMaxNumTokens.value || limit.default, limit.min, limit.max);
  trtTpSize.value = clamp(trtTpSize.value || 1, 1, tensorParallelLimit.value);
}

export function paramLimitText() { const limit = contextLimit.value; return t('modelLimit') + ': ' + limit.max + ' · ' + limit.source; }

/* ── container display helpers ─────────────────── */
export function serviceContainerColor(_container?: ContainerRecord) { return 'green'; }
export function isModelSpecificMissing(container: ContainerRecord) { return container.state === 'missing' && INFERENCE_SERVICES.includes(container.runtime as ServiceType); }
export function actionTargetName(container: ContainerRecord) { return container.instance_name || container.name; }
export function imageStatusColor(container?: ContainerRecord) { return container?.image_pulled ? 'green' : 'gold'; }
export function imageStatusText(container?: ContainerRecord) { return container?.image_pulled ? t('imagePulled') : t('imageMissing'); }
export function testStatusColor(status?: string) { if (status === 'passed') return 'green'; if (status === 'failed') return 'red'; if (status === 'running') return 'blue'; return 'gold'; }
export function testStatusText(status?: string) { if (status === 'passed') return t('testPassed'); if (status === 'failed') return t('testFailed'); if (status === 'running') return t('testRunning'); return t('untested'); }

/* ── deployment helpers ────────────────────────── */
export function selectDeployModel(model: ModelRecord) {
  deployModelId.value = model.id;
  deployOpenAiModel.value = model.id;
  const preferred = containers.value.find((container) => model.compatibility[container.runtime]?.status !== 'unsupported' && container.runtime === model.runtime.preferred)
    ?? containers.value.find((container) => model.compatibility[container.runtime]?.status !== 'unsupported');
  if (preferred) selectedContainerKey.value = preferred.key;
  deployContextLength.value = model.inference?.context_length?.default ?? deployContextLength.value;
  trtMaxNumTokens.value = model.inference?.context_length?.default ?? trtMaxNumTokens.value;
  clampDeployParamsForModel();
}

export function canDeployToSelected(): boolean {
  const model = selectedDeployModel.value;
  const container = selectedContainer.value;
  return Boolean(model && container && container.runtime !== 'custom' && model.compatibility[container.runtime]?.status !== 'unsupported');
}

export function currentLoadedModel(): ModelRecord | undefined {
  const deployment = selectedDeployment.value;
  if (!deployment) return undefined;
  if (deployment.model_id) return models.value.find((item) => item.id === deployment.model_id);
  const selected = selectedDeployModel.value;
  return selected && deployment.openai_models.includes(selected.id) ? selected : undefined;
}

export function selectedRunningModelLabel(): string {
  const deployment = selectedDeployment.value;
  if (!deployment) return t('noRunningModels');
  const selected = selectedDeployModel.value;
  if (selected && deployment.openai_models.includes(selected.id)) return selected.display_name + ' -> ' + (deployment.container_name || deployment.runtime);
  if (deployment.model_id) return deployment.model_id + ' -> ' + (deployment.container_name || deployment.runtime);
  return deployment.openai_models.length ? deployment.openai_models.join(', ') + ' -> ' + (deployment.container_name || deployment.runtime) : t('noRunningModels');
}

export function deploymentIsActive(deployment?: DeploymentRecord): boolean {
  return Boolean(deployment && (deployment.status === 'running' || deployment.openai_models.length));
}

export function selectedPublicBaseUrl(): string { return selectedDeployment.value ? publicBaseUrl(selectedDeployment.value) : ''; }
export function selectedModelEndpoint(): string { return selectedDeployment.value ? modelEndpoint(selectedDeployment.value) : ''; }
export function selectedChatEndpoint(): string { return selectedDeployment.value ? chatEndpoint(selectedDeployment.value) : ''; }
export function expectedContainerName(_model: ModelRecord, serviceType: ServiceType): string {
  return serviceType + '-service';
}

/* ── theme / locale setters ────────────────────── */
export function setLocale(next: Locale) { locale.value = next; localStorage.setItem('locale', next); document.documentElement.lang = next; }
export function setTheme(next: ThemeMode) { themeMode.value = next; localStorage.setItem('themeMode', next); document.documentElement.dataset.theme = next; }

/* ── API ───────────────────────────────────────── */
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail ?? payload.error?.message ?? 'Request failed');
  return payload as T;
}

export async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    message.success(t('copied'));
  } catch {
    message.error(t('copyFailed'));
  }
}

export async function refresh() {
  try {
    const [modelPayload, deploymentPayload, taskPayload, systemPayload, networkPayload, workbenchPayload, containerPayload] = await Promise.all([
      api<{ models: ModelRecord[] }>('/models').catch(() => ({ models: [] })),
      api<{ deployments: DeploymentRecord[] }>('/deployments').catch(() => ({ deployments: [] })),
      api<{ tasks: TaskRecord[] }>('/tasks').catch(() => ({ tasks: [] })),
      api<SystemCheck>('/system/check').catch(() => null),
      api<NetworkSettings>('/settings/network').catch(() => null),
      api<WorkbenchSettings>('/settings/workbench').catch(() => null),
      api<{ containers: ContainerRecord[] }>('/containers').catch(() => ({ containers: [] }))
    ]);
    if (modelPayload) models.value = modelPayload.models ?? [];
    if (deploymentPayload) deployments.value = deploymentPayload.deployments ?? [];
    if (taskPayload) tasks.value = taskPayload.tasks ?? [];
    if (systemPayload) {
      system.value = systemPayload;
      network.value = networkPayload ?? systemPayload.network ?? null;
      workbenchSettings.value = workbenchPayload ?? systemPayload.workbench ?? null;
      managementPort.value = workbenchSettings.value?.management_port ?? 58888;
    }
    const newContainers = containerPayload?.containers ?? [];
    if (newContainers.length > 0 || containers.value.length === 0) {
      containers.value = newContainers;
    }
    if (!deployModelId.value && readyModelList.value[0]) selectDeployModel(readyModelList.value[0]);
    if (selectedDeployModel.value && !containerOptions.value.some((item) => item.value === selectedContainerKey.value)) { const first = containerOptions.value[0]; if (first) selectedContainerKey.value = first.value; }
    if (!deployOpenAiModel.value && deployModelId.value) deployOpenAiModel.value = deployModelId.value;
    if (!selectedContainerKey.value && containerOptions.value[0]) selectedContainerKey.value = containerOptions.value[0].value;
    if (!selectedTaskId.value && tasks.value[0]) selectedTaskId.value = tasks.value[0].id;
  } catch {
    // Silently retry on next interval — API may be starting up
  }
}

export async function loadTaskLog(taskId = selectedTaskId.value) {
  if (!taskId) return;
  const payload = await api<{ logs: string }>('/tasks/' + encodeURIComponent(taskId) + '/logs');
  taskLog.value = payload.logs;
}

export async function loadContainerLogs(name: string) {
  if (!name) return;
  selectedLogContainer.value = name;
  const payload = await api<{ logs: string }>('/containers/' + encodeURIComponent(name) + '/logs?lines=200');
  containerLog.value = payload.logs;
}
