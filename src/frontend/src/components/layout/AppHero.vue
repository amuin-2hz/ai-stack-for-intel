<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { themeMode, t } from '../../composables/useLocale'

const route = useRoute()

const isDark = computed(() => themeMode.value === 'dark')
const heroImage = computed(() => `./brand/${isDark.value ? 'hero-dark.png' : 'hero-light.png'}`)

const pageTitle = computed(() => t((route.meta.titleKey as string) ?? 'dashboard'))
const pageDesc = computed(() => t((route.meta.descKey as string) ?? 'pageDashboardDesc'))
</script>

<template>
  <header class="hero">
    <img class="hero-bg" :src="heroImage" alt="" />
    <div class="hero-copy">
      <p>{{ t('studioName') }}</p>
      <h1>{{ pageTitle }}</h1>
      <span>{{ pageDesc }}</span>
    </div>
  </header>
</template>
