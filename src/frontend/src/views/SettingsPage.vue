<script setup lang="ts">
import { message } from 'ant-design-vue';
import {
  api,
  locale,
  managementPort,
  network,
  networkMessage,
  refresh,
  system,
  t,
  workbenchSettings,
} from '../composables/useApp';

async function saveWorkbenchSettings() {
  try {
    const payload = await api<import('../types').WorkbenchSettings>(
      '/settings/workbench',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ management_port: managementPort.value }),
      },
    );
    workbenchSettings.value = payload;
    message.success(
      payload.requires_restart
        ? (locale.value === 'zh-CN'
          ? '已保存，重启前端服务后生效。'
          : 'Saved. Restart the frontend service to apply.')
        : t('configSaved'),
    );
    await refresh();
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
}

async function toggleLanAccess() {
  if (!network.value) return;
  networkMessage.value = t('savingNetwork');
  try {
    const payload = await api<import('../types').NetworkSettings>(
      '/settings/network',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lan_access_enabled: !network.value.lan_access_enabled,
        }),
      },
    );
    network.value = payload;
    networkMessage.value = payload.requires_restart
      ? t('savedNeedsRestart') + payload.desired_bind_address
      : t('savedActive');
  } catch (error) {
    networkMessage.value = String(error);
  }
}
</script>

<template>
  <section class="settings-panel settings-card-grid">
    <a-card
      :title="locale === 'zh-CN' ? '端口与控制台' : 'Port & Console'"
      class="glass-card settings-card"
      :bordered="false"
    >
      <div class="settings-row-grid">
        <div class="settings-block">
          <b>{{ locale === 'zh-CN' ? '管理端口' : 'Management Port' }}</b>
          <a-input-number
            v-model:value="managementPort"
            :min="1024"
            :max="65535"
            class="full-width"
            style="margin-top:8px"
          />
          <a-button type="primary" block @click="saveWorkbenchSettings" style="margin-top:8px">{{ t('saveConfig') }}</a-button>
        </div>
        <div class="settings-block">
          <b>{{ locale === 'zh-CN' ? '控制台地址' : 'Console Address' }}</b>
          <div class="settings-summary compact-settings-summary" style="margin-top:8px">
            <span>{{ t('apiAddress') }}<b>{{ system?.management_url ?? 'http://localhost:8888' }}</b></span>
            <span>{{ locale === 'zh-CN' ? '配置地址' : 'Configured URL' }}<b>{{ system?.configured_management_url ?? ('http://localhost:' + managementPort) }}</b></span>
            <a-tag v-if="workbenchSettings?.requires_restart" color="gold">{{ t('restartRequired') }}</a-tag>
          </div>
        </div>
      </div>
    </a-card>
    <a-card
      :title="locale === 'zh-CN' ? '网络与绑定' : 'Network & Binding'"
      class="glass-card settings-card"
      :bordered="false"
    >
      <template #extra>
        <a-tag :color="network?.lan_access_enabled ? 'green' : 'gold'">{{ network?.lan_access_enabled ? t('lanEnabled') : t('localhostOnly') }}</a-tag>
      </template>
      <div class="settings-row-grid">
        <div class="settings-block">
          <b>{{ t('networkAccess') }}</b>
          <p class="muted-line">{{ t('networkHint') }}</p>
          <div class="settings-controls compact-settings-controls">
            <a-switch :checked="network?.lan_access_enabled" @change="toggleLanAccess" />
            <a-tag v-if="network?.requires_restart" color="gold">{{ t('restartRequired') }}</a-tag>
          </div>
        </div>
        <div class="settings-block">
          <b>{{ locale === 'zh-CN' ? '绑定状态' : 'Bind Status' }}</b>
          <div class="settings-summary compact-settings-summary" style="margin-top:8px">
            <span>{{ t('activeBind') }}<b>{{ network?.active_bind_address ?? '0.0.0.0' }}</b></span>
            <span>{{ t('desiredBind') }}<b>{{ network?.desired_bind_address ?? '0.0.0.0' }}</b></span>
          </div>
        </div>
      </div>
      <a-alert class="plan-alert compact-plan-alert" type="info" style="margin-top:12px">
        <template #message>
          <pre class="inline-pre">{{ networkMessage || t('networkIdle') }}</pre>
        </template>
      </a-alert>
    </a-card>
  </section>
</template>
