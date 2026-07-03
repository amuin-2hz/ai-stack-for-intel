<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { themeMode, t } from '../../composables/useLocale'

const props = defineProps<{
  sidebarCollapsed: boolean
}>()

defineEmits<{
  'update:sidebarCollapsed': [value: boolean]
}>()

const router = useRouter()
const route = useRoute()

const isDark = computed(() => themeMode.value === 'dark')
const brandImage = computed(() => `./brand/${isDark.value ? 'amuin-light.png' : 'logo-au.png'}`)
const activeKey = computed(() => route.path === '/' ? 'home' : route.path.slice(1))

const navItems = computed(() => [
  { key: 'home', path: '/', icon: 'dashboard', label: t('dashboard') },
  { key: 'chat', path: '/chat', icon: 'modelTest', label: t('chat') },
  { key: 'models', path: '/models', icon: 'modelLibrary', label: t('models') },
  { key: 'engines', path: '/engines', icon: 'runtime', label: t('engines') },
])

function go(path: string) {
  void router.push(path)
}
</script>

<template>
  <aside :class="['sidebar', 'sideNav', sidebarCollapsed ? 'isCollapsed' : 'isExpanded']">
    <div class="sideNavHeader">
      <span class="sideNavMiniLogo"><img :src="brandImage" alt="" /></span>
      <div class="sideNavHeaderText">
        <strong>{{ t('workstation') }}</strong>
        <span>{{ t('studioName') }}</span>
      </div>
      <span class="sideNavVersion">v0.2.0</span>
    </div>

    <nav class="sideNavMenu" aria-label="Main menu">
      <button
        v-for="item in navItems"
        :key="item.key"
        :class="['sideNavItem', activeKey === item.key ? 'isActive' : '']"
        type="button"
        @click="go(item.path)"
      >
        <span :class="['sideNavIcon', item.icon]"></span>
        <span class="sideNavLabel">{{ item.label }}</span>
      </button>
    </nav>

    <div class="sideNavFooter">
      <button
        :class="['sideNavItem', 'sideNavFooterItem', activeKey === 'settings' ? 'isActive' : '']"
        type="button"
        @click="go('/settings')"
      >
        <span class="sideNavIcon settings"></span>
        <span class="sideNavLabel">{{ t('settings') }}</span>
      </button>
    </div>
  </aside>
</template>
