<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { theme as antdTheme } from 'ant-design-vue';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import enUS from 'ant-design-vue/es/locale/en_US';
import AppSidebar from './components/layout/AppSidebar.vue';
import AppTopbar from './components/layout/AppTopbar.vue';
import AppTitlebar from './components/layout/AppTitlebar.vue';
import { locale, themeMode } from './composables/useLocale';
import { refresh } from './composables/useApp';

/* ── antd locale & theme ──────────────────────── */
const antLocale = computed(() => locale.value === 'zh-CN' ? zhCN : enUS);
const isDark = computed(() => themeMode.value === 'dark');
const antTheme = computed(() => ({
  algorithm: isDark.value ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
  token: { colorPrimary: '#0aa7d8', borderRadius: 6 },
}));

/* ── sidebar collapse ──────────────────────────── */
const sidebarCollapsed = ref(false);
let compactSidebarQuery: MediaQueryList | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function syncSidebarMode(event?: MediaQueryListEvent) {
  sidebarCollapsed.value = event ? event.matches : !!compactSidebarQuery?.matches;
}

/* ── lifecycle ────────────────────────────────── */
onMounted(() => {
  document.documentElement.lang = locale.value;
  document.documentElement.dataset.theme = themeMode.value;
  compactSidebarQuery = window.matchMedia('(max-width: 1320px)');
  syncSidebarMode();
  compactSidebarQuery.addEventListener('change', syncSidebarMode);
  // Delay first poll 3s to avoid ECONNREFUSED noise while API boots
  setTimeout(() => { void refresh(); }, 3000);
  refreshTimer = setInterval(() => { void refresh(); }, 15000);
});

onBeforeUnmount(() => {
  compactSidebarQuery?.removeEventListener('change', syncSidebarMode);
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<template>
  <a-config-provider :locale="antLocale" :theme="antTheme">
    <div
      :class="[
        'desktop-shell',
        isDark ? 'theme-dark' : 'theme-light',
      ]"
    >
      <AppTitlebar />
      <AppTopbar v-model:sidebarCollapsed="sidebarCollapsed" />
      <main :class="['app-shell', sidebarCollapsed ? 'sidebar-collapsed' : '']">
        <AppSidebar v-model:sidebarCollapsed="sidebarCollapsed" />
        <section class="workspace">
          <router-view />
        </section>
      </main>
    </div>
  </a-config-provider>
</template>
