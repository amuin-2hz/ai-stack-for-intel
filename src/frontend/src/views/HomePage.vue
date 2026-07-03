<script setup lang="ts">
import { computed, ref } from 'vue';
import type { TaskRecord } from '../types';
import HeroBanner from '../components/shared/HeroBanner.vue';
import StatCard from '../components/shared/StatCard.vue';
import GaugeRing from '../components/shared/GaugeRing.vue';
import {
  dashboardTasks,
  formatBytes,
  loadTaskLog,
  locale,
  publishedModelRows,
  readyModels,
  rightPanelCollapsed,
  selectedTaskId,
  statusText,
  system,
  t,
  taskAlias,
  taskProgress,
  taskSummary,
  taskTypeText,
} from '../composables/useApp';

const memoryUsedBytes = computed(() => {
  const total = system.value?.device?.memory?.total_bytes ?? 0;
  const free = system.value?.device?.memory?.free_bytes ?? 0;
  return Math.max(0, total - free);
});

const memoryPercent = computed(() => {
  const total = system.value?.device?.memory?.total_bytes ?? 0;
  return total ? Math.round((memoryUsedBytes.value / total) * 100) : 0;
});

const cpuPercent = computed(() => Math.round(system.value?.status?.cpu_load_percent ?? 0));
const storageVolume = computed(() => system.value?.device?.storage?.volumes?.[0]);
const storagePercent = computed(() => Math.round(storageVolume.value?.used_percent ?? 0));
const openvinoDevices = computed(() => system.value?.openvino?.devices ?? []);
const npuAvailable = computed(() => openvinoDevices.value.includes('NPU'));
const npuStatusText = computed(() => npuAvailable.value ? (locale.value === 'zh-CN' ? '可用' : 'Ready') : (locale.value === 'zh-CN' ? '未检测到' : 'Unavailable'));
const modelStatusValue = computed(() => locale.value === 'zh-CN' ? `${readyModels.value} 个可用` : `${readyModels.value} ready`);
const publishStatusValue = computed(() => {
  const count = publishedModelRows.value.length;
  if (!count) return locale.value === 'zh-CN' ? '未发布' : 'None';
  return locale.value === 'zh-CN' ? `${count} 个接口` : `${count} endpoints`;
});
const storageUsedSummary = computed(() => {
  const volume = storageVolume.value;
  if (!volume) return '-';
  return `${formatBytes(volume.used_bytes)} / ${formatBytes(volume.total_bytes)}`;
});
const storageFreeSummary = computed(() => {
  const volume = storageVolume.value;
  if (!volume) return '-';
  return locale.value === 'zh-CN' ? `${formatBytes(volume.free_bytes)} 可用 · ${volume.mount}` : `${formatBytes(volume.free_bytes)} free · ${volume.mount}`;
});
const recentDashboardTasks = computed(() => dashboardTasks.value.slice(0, 8));
const publishedPanelOpen = ref(false);
const hostSummary = computed(() => system.value?.device?.hostname ?? system.value?.device?.cpu?.model ?? '-');
const uptimeSummary = computed(() => {
  const seconds = system.value?.status?.uptime_seconds ?? 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
});

function taskKindClass(task: TaskRecord) {
  return ['download', 'deploy', 'container'].includes(task.type) ? task.type : 'container';
}

function openDashboardTask(task: TaskRecord) {
  selectedTaskId.value = task.id;
  void loadTaskLog(task.id);
}
</script>

<template>
  <section :class="['prototype-page dashboard-home-layout', rightPanelCollapsed ? 'is-right-panel-collapsed' : '']">
    <div class="dashboardHomeMain">
      <HeroBanner
        :title="t('dashboard')"
        :eyebrow="t('studioName')"
        :desc="locale === 'zh-CN' ? '本机资源、运行状态和已发布接口总览。' : 'Local resources, runtime health, and published endpoints.'"
      >
        <template #decor>
          <div class="dashboardBannerMeta">
            <a-tag :color="system?.openvino?.ok ? 'green' : 'gold'">
              OpenVINO {{ system?.openvino?.ok ? 'Ready' : 'Unavailable' }}
            </a-tag>
          </div>
        </template>
      </HeroBanner>

      <section class="overviewCards overviewCards--two">
        <StatCard :label="locale === 'zh-CN' ? '模型' : 'Models'" :value="modelStatusValue" />
        <StatCard :label="locale === 'zh-CN' ? '发布状态' : 'Publish Status'" :value="publishStatusValue" />
      </section>

      <section class="resourcePanel">
        <div class="panelHeader">
          <h2>{{ locale === 'zh-CN' ? '资源仪表盘' : 'Resource Dashboard' }}</h2>
        </div>
        <div class="resourceGrid">
          <div class="resourceCard">
            <GaugeRing :percent="cpuPercent" :size="80" />
            <span class="resourceMeta">{{ system?.device?.cpu?.cores ?? 0 }} cores</span>
          </div>
          <div class="resourceCard">
            <GaugeRing :percent="memoryPercent" :size="80" />
            <span class="resourceMeta">{{ formatBytes(memoryUsedBytes) }} / {{ formatBytes(system?.device?.memory?.total_bytes ?? 0) }}</span>
          </div>
          <div class="resourceCard resourceCard--device">
            <div :class="['deviceStatusPill', npuAvailable ? 'is-ready' : 'is-muted']">
              <strong>NPU</strong>
              <span>{{ npuStatusText }}</span>
            </div>
            <span class="resourceMeta resourceMeta--stack">
              <b>{{ openvinoDevices.join(' / ') || 'OpenVINO' }}</b>
              <small>{{ locale === 'zh-CN' ? 'OpenVINO 设备状态' : 'OpenVINO device status' }}</small>
            </span>
          </div>
          <div class="resourceCard">
            <GaugeRing :percent="storagePercent" :size="80" />
            <span class="resourceMeta resourceMeta--stack">
              <b>{{ storageUsedSummary }}</b>
              <small>{{ storageFreeSummary }}</small>
            </span>
          </div>
        </div>
      </section>

    </div>

    <aside v-if="!rightPanelCollapsed" class="dashboardTaskPanel" aria-label="recent tasks">
      <div class="dashboardTaskPanelHead">
        <h2>{{ t('recentTasks') }}</h2>
        <span class="dashboardTaskCount">{{ recentDashboardTasks.length }}</span>
      </div>
      <div class="dashboardTaskList">
        <button
          v-for="task in recentDashboardTasks"
          :key="task.id"
          :class="['dashboardTaskRow', ['running', 'queued', 'paused'].includes(task.status) ? 'hasProgressBeam' : '']"
          :style="{ '--task-progress': taskProgress(task) + '%' }"
          type="button"
          @click="openDashboardTask(task)"
        >
          <span v-if="['running', 'queued', 'paused'].includes(task.status)" class="dashboardTaskBeam"></span>
          <span class="dashboardTaskRowMain">
            <span class="dashboardTaskRowTop">
              <span :class="['dashboardTaskType', taskKindClass(task)]">{{ taskTypeText(task.type) }}</span>
              <strong class="dashboardTaskTitle">{{ taskAlias(task) }}</strong>
            </span>
            <span class="dashboardTaskSummary">{{ taskSummary(task) }}</span>
          </span>
          <span class="dashboardTaskRowSide">
            <span :class="['dashboardTaskStatus', task.status]">{{ statusText(task.status) }}</span>
            <span v-if="['running', 'queued', 'paused'].includes(task.status)" class="dashboardTaskProgress">{{ taskProgress(task) }}%</span>
          </span>
        </button>
        <div v-if="!recentDashboardTasks.length" class="dashboardTaskEmpty">
          {{ locale === 'zh-CN' ? '暂无任务' : 'No tasks' }}
        </div>
      </div>
    </aside>

    <section :class="['dashboard-bottom-panel', publishedPanelOpen ? 'panel-expanded' : '']">
      <button class="panel-toggle-bar" type="button" @click="publishedPanelOpen = !publishedPanelOpen">
        <b>{{ t('publishedContainerModels') }}</b>
        <span class="panel-url-hint">
          {{ publishedModelRows[0]?.address ?? (locale === 'zh-CN' ? '暂无已发布接口' : 'No published endpoints') }}
        </span>
        <span class="panel-arrow">{{ publishedPanelOpen ? '-' : '+' }}</span>
      </button>
      <div class="panel-expand-body">
        <div class="modelTable dashboard-bottom-table">
          <div class="modelTableHead">
            <span>{{ t('modelName') }}</span>
            <span>{{ t('apiAddress') }}</span>
          </div>
          <div class="modelTableBody">
            <div v-for="row in publishedModelRows" :key="row.model_name + row.address" class="modelTableRow">
              <span>{{ row.model_name }}</span>
              <strong>{{ row.address }}</strong>
            </div>
            <div v-if="!publishedModelRows.length" class="modelTableEmpty">
              <div class="emptyBoxIcon"></div>
              <span>{{ locale === 'zh-CN' ? '暂无数据' : 'No Data' }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  </section>
</template>
