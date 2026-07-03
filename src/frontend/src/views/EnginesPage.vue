<script setup lang="ts">
import { computed, reactive, ref, onMounted, onBeforeUnmount } from 'vue';
import { message } from 'ant-design-vue';
import {
  EyeOutlined, PlayCircleOutlined, PauseCircleOutlined,
  SettingOutlined, UnorderedListOutlined,
} from '@ant-design/icons-vue';
import {
  api, refresh, containerStateText,
  runtimeContainers, readyModelList,
  t, locale,
} from '../composables/useApp';
import type { ContainerRecord } from '../types';
import HeroBanner from '../components/shared/HeroBanner.vue';

const engineLabels: Record<string, string> = {
  chat: 'LLM',
  vision: 'VLM',
  asr: 'ASR',
  tts: 'TTS',
};

const engineDesc: Record<string, string> = {
  chat: 'Large Language Model',
  vision: 'Vision Language Model',
  asr: 'Speech Recognition',
  tts: 'Text to Speech',
};

const engineDevices: Record<string, 'CPU' | 'GPU' | 'NPU'> = {
  chat: 'GPU',
  vision: 'GPU',
  asr: 'NPU',
  tts: 'CPU',
};

const enginePorts: Record<string, number> = {
  chat: 31000,
  vision: 31001,
  asr: 31002,
  tts: 31003,
};

type RuntimeSettings = {
  model_id: string;
  device: 'CPU' | 'GPU' | 'NPU';
  port: number;
  max_tokens: number;
  temperature: number;
  language: string;
  speaker: string;
  instruct: string;
};

function defaultRuntimeSettings(key: string): RuntimeSettings {
  return {
    model_id: '',
    device: engineDevices[key] ?? 'GPU',
    port: enginePorts[key] ?? 31000,
    max_tokens: key === 'tts' ? 512 : 256,
    temperature: 0.7,
    language: key === 'asr' ? 'zh' : 'Chinese',
    speaker: 'Vivian',
    instruct: '',
  };
}

const runtimeSettings = reactive<Record<string, RuntimeSettings>>({
  chat: defaultRuntimeSettings('chat'),
  vision: defaultRuntimeSettings('vision'),
  asr: defaultRuntimeSettings('asr'),
  tts: defaultRuntimeSettings('tts'),
});
const runtimeSettingsStorageKey = 'localruntime.engineSettings.v1';

function loadRuntimeSettings() {
  try {
    const raw = window.localStorage.getItem(runtimeSettingsStorageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, Partial<RuntimeSettings>>;
    for (const key of Object.keys(runtimeSettings)) {
      runtimeSettings[key] = { ...defaultRuntimeSettings(key), ...(parsed[key] ?? {}) };
    }
  } catch { /* ignore invalid local settings */ }
}

function persistRuntimeSettings() {
  window.localStorage.setItem(runtimeSettingsStorageKey, JSON.stringify(runtimeSettings));
}

/* ── action state ───────────────────────────────── */
const busyEngines = ref<Record<string, string>>({}); // key → action
const runtimeLogDrawerOpen = ref(false);
const runtimeSettingsDrawerOpen = ref(false);
const selectedSettingsEngine = ref<ContainerRecord | null>(null);
const logDrawerTitle = ref('');
const logDrawerContent = ref('');

function isBusy(container: ContainerRecord, action: string): boolean {
  return busyEngines.value[container.key] === action;
}


function engineLabel(container: ContainerRecord) {
  return engineLabels[container.key] ?? container.title;
}

function runtimeUsageLabel(container: ContainerRecord) {
  return container.state === 'running'
    ? (locale.value === 'zh-CN' ? '使用中' : 'In use')
    : (locale.value === 'zh-CN' ? '未使用' : 'Idle');
}

function statusDotClass(container: ContainerRecord) {
  if (container.state === 'running') return 'green';
  if (container.state === 'error') return 'red';
  if (container.state === 'starting') return 'blue';
  return 'gold';
}

function compatibleModelsFor(key: string) {
  return readyModelList.value.filter((model) => model.compatibility[key]?.status !== 'unsupported');
}

const activeRuntimeSettings = computed(() => selectedSettingsEngine.value ? runtimeSettings[selectedSettingsEngine.value.key] : null);
const activeModelOptions = computed(() => selectedSettingsEngine.value
  ? compatibleModelsFor(selectedSettingsEngine.value.key).map((model) => ({ label: model.display_name, value: model.id }))
  : []
);

function runtimePortLabel(container: ContainerRecord) {
  return container.public_port || runtimeSettings[container.key]?.port || container.ports || '-';
}

function ensureRuntimeSettings(container: ContainerRecord) {
  runtimeSettings[container.key] = { ...defaultRuntimeSettings(container.key), ...(runtimeSettings[container.key] ?? {}) };
  if (!runtimeSettings[container.key].model_id) {
    runtimeSettings[container.key].model_id = compatibleModelsFor(container.key)[0]?.id ?? '';
  }
}

function openRuntimeSettings(container: ContainerRecord) {
  ensureRuntimeSettings(container);
  selectedSettingsEngine.value = container;
  runtimeSettingsDrawerOpen.value = true;
}

function saveRuntimeSettings() {
  persistRuntimeSettings();
  message.success(locale.value === 'zh-CN' ? '参数已保存，下次启动生效' : 'Parameters saved. They apply on next start.');
  runtimeSettingsDrawerOpen.value = false;
}

/* ── engine actions ─────────────────────────────── */
async function startEngine(container: ContainerRecord) {
  if (isBusy(container, 'start')) return;
  busyEngines.value[container.key] = 'start';
  try {
    // Find a ready model compatible with this engine type
    const readyModel = readyModelList.value.find(
      (m) => m.compatibility[container.key]?.status !== 'unsupported'
    );
    if (!readyModel) {
      message.warning(locale.value === 'zh-CN'
        ? `没有找到兼容 ${engineLabel(container)} 引擎的就绪模型，请先在模型库中下载或导入对应类型的模型。`
        : `No ready model compatible with ${engineLabel(container)} engine. Please download or import a compatible model first.`);
      delete busyEngines.value[container.key];
      return;
    }
    ensureRuntimeSettings(container);
    const settings = runtimeSettings[container.key];
    const selectedModel = settings.model_id
      ? readyModelList.value.find((model) => model.id === settings.model_id && model.compatibility[container.key]?.status !== 'unsupported')
      : null;
    const modelToStart = selectedModel ?? readyModel;
    const payload = await api<any>('/engines/' + encodeURIComponent(container.key) + '/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelToStart.id, device: settings.device, port: settings.port }),
    });
    if (payload.engine?.status === 'running') {
      message.success((locale.value === 'zh-CN' ? '引擎已启动：' : 'Engine started: ') + (payload.engine?.model_name ?? container.key));
    } else {
      message.warning(payload.detail ?? payload.engine?.error ?? t('actionFailed'));
    }
    await refresh();
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  } finally {
    delete busyEngines.value[container.key];
  }
}

async function stopEngine(container: ContainerRecord) {
  if (isBusy(container, 'stop')) return;
  busyEngines.value[container.key] = 'stop';
  try {
    // Find running engine of this type
    const engines = await api<{ engines: Array<{ id: string; type: string; status: string }> }>('/engines').catch(() => ({ engines: [] }));
    const running = engines.engines.find((e: any) => e.type === container.key && e.status === 'running');
    if (running) {
      const result = await api<{ ok: boolean; detail: string }>('/engines/' + encodeURIComponent(running.id) + '/stop', { method: 'POST' });
      message.success(result.detail ?? t('actionSucceeded'));
    } else {
      message.info(locale.value === 'zh-CN' ? '引擎未在运行' : 'Engine is not running');
    }
    await refresh();
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  } finally {
    delete busyEngines.value[container.key];
  }
}

async function viewEngineLogs(container: ContainerRecord) {
  logDrawerTitle.value = engineLabel(container) + (locale.value === 'zh-CN' ? ' · 日志' : ' · Logs');
  logDrawerContent.value = locale.value === 'zh-CN' ? '加载中…' : 'Loading…';
  runtimeLogDrawerOpen.value = true;
  try {
    const engines = await api<{ engines: Array<{ id: string; type: string; status: string; port: number; device: string; model_name: string; error?: string }> }>('/engines').catch(() => ({ engines: [] }));
    const engine = engines.engines.find((item: any) => item.type === container.key);
    if (engine) {
      logDrawerContent.value = [
        'Engine: ' + engine.type + ' | Status: ' + engine.status,
        'Model: ' + (engine.model_name ?? '-') + ' | Device: ' + (engine.device ?? '-'),
        'Port: ' + (engine.port ?? '-'),
        engine.error ? 'Error: ' + engine.error : '',
      ].filter(Boolean).join('\n');
    } else {
      logDrawerContent.value = locale.value === 'zh-CN' ? '引擎未启动。点击「启动」加载模型。' : 'Engine not started. Click Start to load the model.';
    }
  } catch {
    logDrawerContent.value = 'Failed to fetch engine logs';
  }
}


/* ── periodic refresh ───────────────────────────── */
let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => { loadRuntimeSettings(); setTimeout(() => { refresh(); timer = setInterval(() => { refresh(); }, 15000); }, 3000); });
onBeforeUnmount(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <section class="contentPanel runtime-layout engine-runtime-layout">
    <HeroBanner
      :title="locale === 'zh-CN' ? '推理引擎' : 'Inference Runtime'"
      :eyebrow="t('studioName')"
      :desc="locale === 'zh-CN' ? '启动、停止和查看本地 OpenVINO 推理引擎日志。' : 'Start, stop, and inspect local OpenVINO inference engines.'"
    />

    <div class="preset-container-grid engine-runtime-grid">
      <article v-for="container in runtimeContainers" :key="container.key" class="runtime-card engine-runtime-card">
        <div class="runtime-card-head">
          <h2>{{ engineLabel(container) }}</h2>
          <span :class="['runtime-usage-pill', container.state === 'running' ? 'is-active' : '']">{{ runtimeUsageLabel(container) }}</span>
        </div>

        <div class="runtime-card-facts">
          <div class="runtime-fact">
            <span>{{ locale === 'zh-CN' ? '类型' : 'Type' }}</span>
            <strong>{{ engineDesc[container.key] ?? engineLabel(container) }}</strong>
          </div>
          <div class="runtime-fact">
            <span>{{ locale === 'zh-CN' ? '状态' : 'Status' }}</span>
            <div class="runtime-status-list">
              <small :class="['runtime-status-dot', statusDotClass(container)]">{{ containerStateText(container) }}</small>
            </div>
          </div>
        </div>

        <div class="runtime-card-actions">
          <a-tag class="runtime-port-tag" color="blue">{{ t('port') }} {{ runtimePortLabel(container) }}</a-tag>

          <a-tooltip :title="container.state === 'running' ? t('stop') : t('start')">
            <a-button
              v-if="container.state === 'running'"
              class="runtime-action-icon"
              size="small"
              shape="circle"
              danger
              :loading="isBusy(container, 'stop')"
              :disabled="!!busyEngines[container.key]"
              @click="stopEngine(container)"
            ><template #icon><PauseCircleOutlined /></template></a-button>
            <a-button
              v-else
              class="runtime-action-icon"
              size="small"
              shape="circle"
              :loading="isBusy(container, 'start')"
              :disabled="!!busyEngines[container.key]"
              @click="startEngine(container)"
            ><template #icon><PlayCircleOutlined /></template></a-button>
          </a-tooltip>

          <a-tooltip :title="locale === 'zh-CN' ? '参数设置' : 'Parameters'">
            <a-button class="runtime-action-icon" size="small" shape="circle" @click="openRuntimeSettings(container)"><template #icon><SettingOutlined /></template></a-button>
          </a-tooltip>

          <a-tooltip :title="t('viewLogs')">
            <a-button class="runtime-action-icon" size="small" shape="circle" @click="viewEngineLogs(container)"><template #icon><EyeOutlined /></template></a-button>
          </a-tooltip>

          <a-popover trigger="click" placement="top">
            <template #content>
              <div class="runtime-detail-popover">
                <span>{{ locale === 'zh-CN' ? '运行时' : 'Runtime' }}<b>{{ container.runtime }}</b></span>
                <span>{{ locale === 'zh-CN' ? '设备' : 'Device' }}<b>{{ engineDevices[container.key] ?? 'GPU' }}</b></span>
                <span>{{ t('port') }}<b>{{ runtimePortLabel(container) }}</b></span>
              </div>
            </template>
            <a-button class="runtime-action-icon" size="small" shape="circle" :aria-label="locale === 'zh-CN' ? '详情' : 'Details'"><template #icon><UnorderedListOutlined /></template></a-button>
          </a-popover>
        </div>
      </article>
    </div>

    <a-drawer
      v-model:open="runtimeLogDrawerOpen"
      class="runtime-log-drawer"
      placement="bottom"
      :height="'42vh'"
      :mask-closable="true"
      :destroy-on-close="false"
      :title="logDrawerTitle"
    >
      <pre class="runtime-log-drawer-block">{{ logDrawerContent || (locale === 'zh-CN' ? '暂无日志输出。' : 'No logs yet.') }}</pre>
    </a-drawer>

    <a-drawer
      v-model:open="runtimeSettingsDrawerOpen"
      class="runtime-settings-drawer"
      placement="right"
      :width="380"
      :title="selectedSettingsEngine ? engineLabel(selectedSettingsEngine) + (locale === 'zh-CN' ? ' · 参数' : ' · Parameters') : ''"
    >
      <a-form v-if="activeRuntimeSettings && selectedSettingsEngine" layout="vertical" class="runtime-settings-form">
        <a-form-item :label="locale === 'zh-CN' ? '模型' : 'Model'">
          <a-select
            v-model:value="activeRuntimeSettings.model_id"
            :options="activeModelOptions"
            :placeholder="locale === 'zh-CN' ? '选择兼容模型' : 'Select compatible model'"
          />
        </a-form-item>

        <div class="runtime-settings-row">
          <a-form-item :label="locale === 'zh-CN' ? '设备' : 'Device'">
            <a-select v-model:value="activeRuntimeSettings.device">
              <a-select-option value="CPU">CPU</a-select-option>
              <a-select-option value="GPU">GPU</a-select-option>
              <a-select-option value="NPU">NPU</a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item :label="t('port')">
            <a-input-number v-model:value="activeRuntimeSettings.port" :min="30000" :max="60000" style="width: 100%" />
          </a-form-item>
        </div>

        <a-divider>{{ locale === 'zh-CN' ? '推理参数' : 'Inference' }}</a-divider>

        <div class="runtime-settings-row">
          <a-form-item :label="selectedSettingsEngine.key === 'tts' ? 'max_new_tokens' : 'max_tokens'">
            <a-input-number v-model:value="activeRuntimeSettings.max_tokens" :min="16" :max="4096" style="width: 100%" />
          </a-form-item>
          <a-form-item v-if="selectedSettingsEngine.key === 'chat'" label="temperature">
            <a-input-number v-model:value="activeRuntimeSettings.temperature" :min="0" :max="2" :step="0.1" style="width: 100%" />
          </a-form-item>
        </div>

        <a-form-item v-if="['asr', 'tts'].includes(selectedSettingsEngine.key)" :label="locale === 'zh-CN' ? '语言' : 'Language'">
          <a-input v-model:value="activeRuntimeSettings.language" />
        </a-form-item>
        <a-form-item v-if="selectedSettingsEngine.key === 'tts'" :label="locale === 'zh-CN' ? '音色' : 'Speaker'">
          <a-input v-model:value="activeRuntimeSettings.speaker" />
        </a-form-item>
        <a-form-item v-if="selectedSettingsEngine.key === 'tts'" label="instruct">
          <a-textarea v-model:value="activeRuntimeSettings.instruct" :rows="3" />
        </a-form-item>

        <div class="runtime-settings-actions">
          <a-button @click="runtimeSettingsDrawerOpen = false">{{ locale === 'zh-CN' ? '取消' : 'Cancel' }}</a-button>
          <a-button type="primary" @click="saveRuntimeSettings">{{ locale === 'zh-CN' ? '保存' : 'Save' }}</a-button>
        </div>
      </a-form>
    </a-drawer>
  </section>
</template>
