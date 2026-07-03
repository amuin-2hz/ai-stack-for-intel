<script setup lang="ts">
import { useRouter } from 'vue-router';
import { computed, ref } from 'vue';
import { message, Modal } from 'ant-design-vue';
import {
  DeleteOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  RocketOutlined,
} from '@ant-design/icons-vue';
import HeroBanner from '../components/shared/HeroBanner.vue';
import {
  api, badgeColor, canDeleteModel, compatibilityRows,
  deployments, downloadTasks, formatBytes, importMessage, importPreview,
  loadTaskLog, locale, modelAuditSummary, modelLibraryList, modelStatusHelp,
  modelUrl, refresh, rightPanelCollapsed, runtimeHintColor, selectedDownloadLogId, selectedTaskId,
  selectDeployModel, shortModelPath, statusText, t, taskAlias, taskSummary,
} from '../composables/useApp';
import type { ModelRecord, TaskRecord } from '../types';

const router = useRouter();
const startingModelId = ref('');
const librarySearch = ref('');
const libraryCategory = ref('all');
const activeModelId = ref('');
const downloadDialogOpen = ref(false);

const categories = ['Chat', 'Vision', 'ASR', 'TTS'];
const formatLabel = 'OpenVINO IR';

function callableModelName(model: ModelRecord) {
  const deployment = deployments.value.find((item) => item.model_id === model.id || item.openai_models.includes(model.id));
  return deployment?.openai_models?.[0] || model.display_name;
}

const modelStorageBytes = computed(() =>
  modelLibraryList.value.reduce((total, model) => total + (model.local.size_bytes || 0), 0)
);

function modelCapabilities(model: ModelRecord) {
  const capabilityNames: Record<string, string> = { chat: 'Chat', vision: 'Vision', asr: 'ASR', tts: 'TTS' };
  const values = Object.entries(capabilityNames)
    .filter(([runtime]) => model.compatibility[runtime]?.status !== 'unsupported')
    .map(([, label]) => label);
  return values.length ? values : [model.runtime.preferred || 'Model'];
}

function modelArchitecture(model: ModelRecord) {
  const name = [model.id, model.display_name].join(' ').toLowerCase();
  if (name.includes('qwen')) return 'Qwen';
  if (name.includes('phi')) return 'Phi';
  if (name.includes('llama')) return 'Llama';
  return model.local.format || 'IR';
}

function modelQuantization(model: ModelRecord) {
  const text = [model.id, model.display_name, model.local.path].join(' ').toLowerCase();
  if (text.includes('int8')) return 'INT8';
  if (text.includes('int4')) return 'INT4';
  if (text.includes('fp16')) return 'FP16';
  if (text.includes('bf16')) return 'BF16';
  return 'Default';
}

function modelParameterScale(model: ModelRecord) {
  const text = [model.id, model.display_name].join(' ');
  const match = text.match(/(\d+(?:\.\d+)?)\s*[bB]/);
  return match ? `${match[1]}B` : '-';
}

function categoryCount(category: string) {
  if (category === 'all') return modelLibraryList.value.length;
  return modelLibraryList.value.filter((model) => modelCapabilities(model).includes(category)).length;
}

const filteredModels = computed(() => {
  const term = librarySearch.value.trim().toLowerCase();
  return modelLibraryList.value.filter((model) => {
    const categoryMatched = libraryCategory.value === 'all' || modelCapabilities(model).includes(libraryCategory.value);
    if (!categoryMatched) return false;
    if (!term) return true;
    return [model.id, callableModelName(model), model.display_name, model.local.path, model.local.format, model.runtime.preferred]
      .join(' ')
      .toLowerCase()
      .includes(term);
  });
});

const activeModel = computed(() => {
  if (activeModelId.value) {
    const selected = modelLibraryList.value.find((model) => model.id === activeModelId.value);
    if (selected) return selected;
  }
  return filteredModels.value[0] ?? modelLibraryList.value[0];
});

const compatibleRuntimeRows = computed(() =>
  activeModel.value ? compatibilityRows(activeModel.value).filter((item) => item.info.status !== 'unsupported') : []
);

const modelRootHint = computed(() => {
  const modelPath = modelLibraryList.value.find((model) => model.local.path)?.local.path || '';
  if (!modelPath) return locale.value === 'zh-CN' ? '尚未发现本地模型' : 'No local models discovered yet';
  const marker = '/models/';
  const index = modelPath.indexOf(marker);
  if (index >= 0) return modelPath.slice(0, index + marker.length - 1);
  const parts = modelPath.split('/').filter(Boolean);
  if (parts.length <= 1) return modelPath;
  return (modelPath.startsWith('/') ? '/' : '') + parts.slice(0, -1).join('/');
});

function modelTableRow(record: ModelRecord) {
  return {
    onClick: () => {
      activeModelId.value = record.id;
    },
  };
}

function openDownloadDialog() {
  downloadDialogOpen.value = true;
}

async function importPlan() {
  if (!modelUrl.value.trim()) return;
  importMessage.value = t('parsing'); importPreview.value = null;
  try {
    const payload = await api<any>('/models/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: modelUrl.value.trim(), provider: 'auto', expected_runtime: 'openvino' }),
    });
    importPreview.value = payload;
    importMessage.value = [t('provider') + ': ' + payload.model?.provider, t('repo') + ': ' + payload.model?.repo_id, t('target') + ': ' + payload.model?.target_path, payload.download?.command ? t('command') + ': ' + payload.download.command : payload.message].filter(Boolean).join('\n');
  } catch (e) { importMessage.value = String(e); }
}

async function startDownload() {
  if (!modelUrl.value.trim()) return;
  importMessage.value = t('startingDownload');
  try {
    const payload = await api<any>('/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: modelUrl.value.trim(), provider: 'auto', expected_runtime: 'openvino' }),
    });
    importMessage.value = t('downloadTaskStarted') + ': ' + payload.task.id;
    selectedDownloadLogId.value = payload.task.id; selectedTaskId.value = payload.task.id;
    await refresh(); await loadTaskLog(payload.task.id);
  } catch (e) { importMessage.value = String(e); }
}

async function openModelFolder(model: ModelRecord) {
  await api('/models/' + encodeURIComponent(model.id) + '/open-folder', { method: 'POST' });
}

async function deleteLocalModel(model: ModelRecord) {
  if (!canDeleteModel(model)) { message.warning(t('deleteBlocked')); return; }
  Modal.confirm({
    title: locale.value === 'zh-CN' ? '确认删除模型' : 'Confirm Delete Model',
    content: [t('modelName') + ': ' + model.display_name, t('path') + ': ' + model.local.path, t('size') + ': ' + formatBytes(model.local.size_bytes), t('format') + ': ' + model.local.format].join('\n'),
    okText: locale.value === 'zh-CN' ? '确认删除' : 'Confirm Delete', okType: 'danger', cancelText: locale.value === 'zh-CN' ? '取消' : 'Cancel', width: 520,
    onOk: async () => {
      const hide = message.loading(t('deleting'), 0);
      try { await api('/models/' + encodeURIComponent(model.id), { method: 'DELETE' }); message.success(t('deleted')); await refresh(); }
      catch (e) { message.error(e instanceof Error ? e.message : String(e)); }
      finally { hide(); }
    },
  });
}

async function publishModelFromCatalog(model: ModelRecord) {
  if (startingModelId.value) return;
  selectDeployModel(model);

  const engineTypes = ['chat', 'vision', 'asr', 'tts'] as const;
  const preferred = model.runtime.preferred as string;
  const engineType = (engineTypes.includes(preferred as any) && model.compatibility[preferred]?.status !== 'unsupported')
    ? preferred
    : engineTypes.find((type) => model.compatibility[type]?.status !== 'unsupported');

  if (!engineType) {
    message.warning(locale.value === 'zh-CN'
      ? `模型 "${model.display_name}" 格式不兼容当前推理引擎`
      : `Model "${model.display_name}" format is incompatible with current inference engines`);
    return;
  }

  const device = engineType === 'asr' ? 'NPU' : 'GPU';
  startingModelId.value = model.id;

  try {
    const payload = await api<any>('/engines/' + encodeURIComponent(engineType) + '/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: model.id, device }),
    });
    if (payload.engine?.status === 'running') {
      message.success((locale.value === 'zh-CN' ? '引擎已启动：' : 'Engine started: ') + model.display_name);
    } else {
      message.warning(payload.detail ?? payload.engine?.error ?? t('actionFailed'));
    }
    await refresh();
    router.push('/engines');
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  } finally {
    startingModelId.value = '';
  }
}

function openTask(task: TaskRecord) {
  selectedDownloadLogId.value = task.id;
  selectedTaskId.value = task.id;
  void loadTaskLog(task.id);
}
</script>

<template>
  <section :class="['contentPanel', 'model-library-workspace', rightPanelCollapsed ? 'right-panel-collapsed' : '']">
    <aside class="librarySidebar">
      <div class="librarySidebarHeader">
        <span>{{ t('studioName') }}</span>
        <h1>{{ locale === 'zh-CN' ? '我的模型' : 'My Models' }}</h1>
        <p>{{ locale === 'zh-CN' ? '按能力分类查看本地模型，并快速加载、打开目录或删除。' : 'Browse local models by capability and quickly load, open, or delete them.' }}</p>
      </div>
      <div class="libraryNavGroup">
        <button type="button" :class="['libraryCategoryButton', libraryCategory === 'all' ? 'isActive' : '']" @click="libraryCategory = 'all'">
          <span>{{ locale === 'zh-CN' ? '全部模型' : 'All Models' }}</span>
          <strong>{{ categoryCount('all') }}</strong>
        </button>
        <button v-for="category in categories" :key="category" type="button" :class="['libraryCategoryButton', libraryCategory === category ? 'isActive' : '']" @click="libraryCategory = category">
          <span>{{ category }}</span>
          <strong>{{ categoryCount(category) }}</strong>
        </button>
      </div>
      <div class="librarySidebarFooter">
        <div class="librarySidebarSync">
          <span>{{ locale === 'zh-CN' ? '本地模型目录' : 'Local model directory' }}</span>
          <strong>{{ modelLibraryList.length }}</strong>
          <small>{{ formatBytes(modelStorageBytes) }}</small>
        </div>
      </div>
    </aside>

    <div class="models-main-col libraryMainPanel">
      <HeroBanner
        class="libraryBanner"
        eyebrow="MODEL LIBRARY"
        :title="locale === 'zh-CN' ? '模型库' : 'Model Library'"
        :desc="locale === 'zh-CN' ? '管理本地模型、下载任务与运行建议。' : 'Manage local models, download tasks, and runtime guidance.'"
      >
        <template #decor>
          <a-button class="libraryDownloadButton" type="primary" @click="openDownloadDialog">
            <template #icon><DownloadOutlined /></template>
            {{ locale === 'zh-CN' ? '下载' : 'Download' }}
          </a-button>
        </template>
      </HeroBanner>

      <header class="libraryToolbar">
        <div class="libraryToolbarTitleGroup">
          <strong>{{ locale === 'zh-CN' ? '模型清单' : 'Model List' }}</strong>
          <span>{{ locale === 'zh-CN' ? `当前显示 ${filteredModels.length} / 共 ${modelLibraryList.length} 个模型` : `Showing ${filteredModels.length} of ${modelLibraryList.length} models` }}</span>
        </div>
        <div class="libraryToolbarActions">
          <label class="librarySearchField">
            <span class="librarySearchIcon">⌕</span>
            <input v-model="librarySearch" type="text" :placeholder="locale === 'zh-CN' ? '筛选模型...' : 'Filter models...'" />
          </label>
        </div>
      </header>

      <a-table
        :data-source="filteredModels"
        :pagination="false"
        size="small"
        row-key="id"
        class="model-library-table"
        :scroll="{ y: 'calc(100vh - 366px)' }"
        :custom-row="modelTableRow"
        :row-class-name="(record: ModelRecord) => activeModel?.id === record.id ? 'selected-library-model' : ''"
      >
        <template #empty>
          <a-empty :description="locale === 'zh-CN' ? '还没有本地模型' : 'No local models yet'" />
        </template>
        <a-table-column :title="locale === 'zh-CN' ? '模型ID' : 'Model ID'" key="model" :width="240">
          <template #default="{ record }">
            <div class="table-model-cell">
              <span class="table-model-name">{{ callableModelName(record) }}</span>
              <span class="table-model-path">Local ID: {{ record.id }}</span>
            </div>
          </template>
        </a-table-column>
        <a-table-column :title="locale === 'zh-CN' ? '框架' : 'Framework'" key="architecture" :width="96">
          <template #default="{ record }"><span class="table-mono-chip">{{ modelArchitecture(record) }}</span></template>
        </a-table-column>
        <a-table-column :title="locale === 'zh-CN' ? '参数量' : 'Params'" key="params" :width="78">
          <template #default="{ record }"><span class="table-compact-text">{{ modelParameterScale(record) }}</span></template>
        </a-table-column>
        <a-table-column :title="locale === 'zh-CN' ? '量化规格' : 'Quantization'" key="quantization" :width="98">
          <template #default="{ record }"><span class="table-mono-chip">{{ modelQuantization(record) }}</span></template>
        </a-table-column>
        <a-table-column :title="t('size')" key="size" :width="88">
          <template #default="{ record }"><span class="table-compact-text">{{ formatBytes(record.local.size_bytes) }}</span></template>
        </a-table-column>
        <a-table-column :title="locale === 'zh-CN' ? '状态' : 'Status'" key="status" :width="90">
          <template #default="{ record }"><a-tag :color="badgeColor(record.status.download)">{{ statusText(record.status.download) }}</a-tag></template>
        </a-table-column>
        <a-table-column key="actions" :width="118">
          <template #default="{ record }">
            <a-space :size="4" @click.stop>
              <a-button size="small" @click.stop="openModelFolder(record)"><template #icon><FolderOpenOutlined /></template></a-button>
              <a-button size="small" type="primary" :loading="startingModelId === record.id" :disabled="record.status.download !== 'ready'" @click.stop="publishModelFromCatalog(record)"><template #icon><RocketOutlined /></template></a-button>
              <a-button size="small" danger :disabled="!canDeleteModel(record)" @click.stop="deleteLocalModel(record)"><template #icon><DeleteOutlined /></template></a-button>
            </a-space>
          </template>
        </a-table-column>
      </a-table>

      <div class="model-library-footer">
        <span>{{ locale === 'zh-CN' ? '已显示' : 'Showing' }} <b>{{ filteredModels.length }}</b> / <b>{{ modelLibraryList.length }}</b></span>
        <span>{{ locale === 'zh-CN' ? '磁盘占用' : 'Disk usage' }} <b>{{ formatBytes(modelStorageBytes) }}</b></span>
        <span>{{ locale === 'zh-CN' ? '模型目录' : 'Model root' }} <b>{{ modelRootHint }}</b></span>
      </div>
    </div>

    <aside v-show="!rightPanelCollapsed" class="models-log-col modelDetailPanel">
      <template v-if="activeModel">
        <div class="modelDetailSection">
          <div class="modelDetailSectionHead">
            <h3>{{ callableModelName(activeModel) }}</h3>
            <span class="modelDetailBadge">{{ activeModel.local.format }}</span>
          </div>
          <div class="modelDetailKv">
            <div class="modelDetailKvRow"><span>{{ locale === 'zh-CN' ? '调用 ID' : 'API Model' }}</span><strong>{{ callableModelName(activeModel) }}</strong></div>
            <div class="modelDetailKvRow"><span>{{ t('path') }}</span><strong>{{ shortModelPath(activeModel.local.path) }}</strong></div>
            <div class="modelDetailKvRow"><span>{{ t('size') }}</span><strong>{{ formatBytes(activeModel.local.size_bytes) }}</strong></div>
            <div class="modelDetailKvRow"><span>{{ t('files') }}</span><strong>{{ activeModel.local.file_count }}</strong></div>
            <div class="modelDetailKvRow"><span>{{ locale === 'zh-CN' ? '能力' : 'Capabilities' }}</span><strong>{{ modelCapabilities(activeModel).join(', ') }}</strong></div>
          </div>
          <div class="modelDetailActions">
            <a-button size="small" type="primary" :loading="startingModelId === activeModel.id" :disabled="activeModel.status.download !== 'ready'" @click="publishModelFromCatalog(activeModel)">{{ locale === 'zh-CN' ? '加载模型' : 'Load Model' }}</a-button>
            <a-button size="small" @click="openModelFolder(activeModel)">{{ t('openFolder') }}</a-button>
          </div>
        </div>

        <div class="modelDetailSection">
          <div class="modelDetailSectionHead">
            <h3>{{ locale === 'zh-CN' ? '运行建议' : 'Runtime Guidance' }}</h3>
          </div>
          <div class="modelDetailKv">
            <div class="modelDetailKvRow"><span>{{ locale === 'zh-CN' ? '推荐运行时' : 'Recommended' }}</span><strong>{{ activeModel.runtime.preferred || '-' }}</strong></div>
            <div class="modelDetailKvRow"><span>{{ locale === 'zh-CN' ? '量化' : 'Quantization' }}</span><strong>{{ modelQuantization(activeModel) }}</strong></div>
          </div>
          <a-space wrap style="margin-top:8px">
            <a-tag v-for="item in compatibleRuntimeRows" :key="item.service" :color="runtimeHintColor(item.info.status)">
              {{ item.service }} · {{ statusText(item.info.status) }}
            </a-tag>
          </a-space>
          <p v-if="modelStatusHelp(activeModel) || modelAuditSummary(activeModel)" class="modelDetailNote">
            {{ modelStatusHelp(activeModel) || modelAuditSummary(activeModel) }}
          </p>
        </div>

        <div class="modelDetailSection modelDetailDownloadSection">
          <div class="modelDetailSectionHead">
            <h3>{{ locale === 'zh-CN' ? '下载任务' : 'Download Tasks' }}</h3>
            <span class="modelDetailCount">{{ downloadTasks.length }}</span>
          </div>
          <div class="modelDetailTaskList">
            <button v-for="task in downloadTasks.slice(0, 6)" :key="task.id" type="button" class="modelDetailTaskRow" @click="openTask(task)">
              <span class="modelDetailTaskName">
                <b>{{ taskAlias(task) }}</b>
                <small>{{ taskSummary(task) }}</small>
              </span>
              <a-tag :color="badgeColor(task.status)">{{ statusText(task.status) }}</a-tag>
            </button>
            <div v-if="!downloadTasks.length" class="modelDetailEmpty">{{ locale === 'zh-CN' ? '暂无下载任务' : 'No downloads' }}</div>
          </div>
        </div>
      </template>
      <template v-else>
        <div class="modelDetailSection">
          <div class="modelDetailSectionHead">
            <h3>{{ locale === 'zh-CN' ? '模型详情' : 'Model Details' }}</h3>
          </div>
          <p class="modelDetailNote">{{ locale === 'zh-CN' ? '从表格中选择一个模型后，这里会显示模型信息、推荐运行时和下载任务。' : 'Select a model from the table to preview metadata, recommended runtime, and download tasks.' }}</p>
        </div>
      </template>
    </aside>

    <a-modal
      v-model:open="downloadDialogOpen"
      class="library-download-modal"
      :title="locale === 'zh-CN' ? '下载模型' : 'Download Model'"
      :footer="null"
      :width="760"
      :destroy-on-close="false"
      :mask-style="{ backgroundColor: 'rgba(0, 0, 0, 0.28)' }"
    >
      <div class="libraryImportForm libraryImportForm--modal">
        <a-input v-model:value="modelUrl" :placeholder="t('urlPlaceholder')" />
        <span class="table-mono-chip">{{ formatLabel }}</span>
        <a-button @click="importPlan">{{ t('checkLink') }}</a-button>
        <a-button type="primary" @click="startDownload">{{ t('download') }}</a-button>
        <a-button @click="refresh"><template #icon><ReloadOutlined /></template>{{ t('refresh') }}</a-button>
      </div>

      <a-alert v-if="importMessage" type="info" show-icon class="model-download-alert model-download-alert--modal">
        <template #message>
          <pre class="inline-pre">{{ importMessage }}</pre>
          <div v-if="importPreview?.runtime_hints?.length" class="models-runtime-hints">
            <b>{{ t('runtimeCompatibility') }}</b>
            <a-space wrap>
              <a-tooltip v-for="hint in importPreview.runtime_hints" :key="hint.runtime" :title="hint.reason">
                <a-tag :color="runtimeHintColor(hint.status)">{{ hint.label }} · {{ statusText(hint.status) }}</a-tag>
              </a-tooltip>
            </a-space>
          </div>
        </template>
      </a-alert>
    </a-modal>
  </section>
</template>
