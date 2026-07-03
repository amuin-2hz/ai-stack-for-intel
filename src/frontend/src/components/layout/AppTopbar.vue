<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { DownloadOutlined } from '@ant-design/icons-vue'
import { locale, themeMode, setLocale, setTheme, t } from '../../composables/useLocale'
import { rightPanelCollapsed, locale as appLocale, themeMode as appThemeMode } from '../../composables/useApp'

const props = defineProps<{
  sidebarCollapsed: boolean
}>()

const emit = defineEmits<{
  'update:sidebarCollapsed': [value: boolean]
}>()

const route = useRoute()
const isDark = computed(() => themeMode.value === 'dark')
const routeTitle = computed(() => t((route.meta.titleKey as string) ?? 'dashboard'))

function toggleTheme(checked: boolean | string | number) {
  const next = checked ? 'dark' : 'light'
  setTheme(next)
  appThemeMode.value = next
}

function toggleLocale(checked: boolean | string | number) {
  const next = checked ? 'en-US' : 'zh-CN'
  setLocale(next)
  appLocale.value = next
}

function toggleSidebar() {
  emit('update:sidebarCollapsed', !props.sidebarCollapsed)
}
</script>

<template>
  <section class="shell-toolbar">
    <div class="shell-toolbar-left">
      <button
        :class="['shell-sidebar-dock', sidebarCollapsed ? 'is-collapsed' : '']"
        type="button"
        :aria-label="locale === 'zh-CN' ? '侧边栏' : 'Sidebar'"
        @click="toggleSidebar"
      />
    </div>

    <div class="shell-toolbar-center">
      <button class="shell-model-picker" type="button" tabindex="-1">
        <span>{{ routeTitle }}</span>
        <kbd>AI Stack for Intel</kbd>
      </button>
    </div>

    <div class="shell-toolbar-right">
      <button
        :class="['toolbarSwitchButton', isDark ? 'isChecked' : '']"
        type="button"
        :aria-pressed="isDark"
        @click="toggleTheme(isDark ? 0 : 1)"
      >
        <span class="switchLabel">{{ isDark ? 'Dark' : 'Light' }}</span>
        <span class="switchTrack"><span class="switchThumb"></span></span>
      </button>
      <button
        :class="['toolbarSwitchButton', locale === 'en-US' ? 'isChecked' : '']"
        type="button"
        :aria-pressed="locale === 'en-US'"
        @click="toggleLocale(locale === 'en-US' ? 0 : 1)"
      >
        <span class="switchLabel">{{ locale === 'en-US' ? 'EN' : '中' }}</span>
        <span class="switchTrack"><span class="switchThumb"></span></span>
      </button>
      <button
        class="toolbarIconButton"
        type="button"
        :aria-label="locale === 'zh-CN' ? '下载任务' : 'Downloads'"
        :title="locale === 'zh-CN' ? '下载任务' : 'Downloads'"
      >
        <DownloadOutlined class="toolbarSvgIcon" />
      </button>
      <button
        :class="['toolbarIconButton', rightPanelCollapsed ? '' : 'isActive']"
        type="button"
        :aria-label="locale === 'zh-CN' ? '右侧面板' : 'Right Panel'"
        :title="locale === 'zh-CN' ? '右侧面板' : 'Right Panel'"
        @click="rightPanelCollapsed = !rightPanelCollapsed"
      >
        <span class="toolbarIcon">{{ rightPanelCollapsed ? '◨' : '◧' }}</span>
      </button>
    </div>
  </section>
</template>
