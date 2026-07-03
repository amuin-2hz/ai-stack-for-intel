<script setup lang="ts">
import { computed } from 'vue';
import { themeMode } from '../../composables/useLocale';

defineProps<{
  eyebrow?: string;
  title: string;
  desc?: string;
}>();

const isDark = computed(() => themeMode.value === 'dark');
const heroImage = computed(() => `./brand/${isDark.value ? 'hero-dark.png' : 'hero-light.png'}`);
</script>

<template>
  <section class="homeBanner">
    <img class="prototype-banner-bg" :src="heroImage" alt="" />
    <div class="homeBannerInner">
      <span v-if="eyebrow" class="homeBannerEyebrow">{{ eyebrow }}</span>
      <h1>{{ title }}</h1>
      <p v-if="desc">{{ desc }}</p>
    </div>
    <div class="homeBannerDecor">
      <slot name="decor" />
    </div>
  </section>
</template>
