<script setup lang="ts">
import { computed } from 'vue'
import { themeMode } from '../../composables/useLocale'

const isDark = computed(() => themeMode.value === 'dark')
const brandImage = computed(() => `./brand/${isDark.value ? 'amuin-light.png' : 'logo-au.png'}`)
</script>

<template>
  <header class="shell-titlebar">
    <div></div>
    <div class="shell-titlegroup">
      <img :src="brandImage" alt="" />
      <strong>AI Stack for Intel</strong>
    </div>
    <div class="shell-window-actions" aria-hidden="true">
      <span>-</span>
      <span>□</span>
      <span>x</span>
    </div>
  </header>
</template>
