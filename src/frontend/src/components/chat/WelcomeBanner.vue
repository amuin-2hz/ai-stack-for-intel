<script setup lang="ts">
import { locale } from '../../composables/useLocale';
</script>

<template>
  <div class="welcome-banner">
    <div class="welcome-icon">🧠</div>
    <h2>{{ locale === 'zh-CN' ? 'AI Stack for Intel 对话' : 'AI Stack for Intel Chat' }}</h2>
    <p class="welcome-desc">
      {{ locale === 'zh-CN' ? '在本地 Intel NPU/GPU 上运行的大语言模型，完全离线、隐私安全。' : 'LLM running locally on Intel NPU/GPU. Fully offline and private.' }}
    </p>
    <div class="welcome-caps">
      <div class="welcome-cap">
        <span class="cap-icon">💬</span>
        <span class="cap-label">{{ locale === 'zh-CN' ? '多轮对话' : 'Multi-turn Chat' }}</span>
      </div>
      <div class="welcome-cap">
        <span class="cap-icon">🔒</span>
        <span class="cap-label">{{ locale === 'zh-CN' ? '本地隐私' : 'Local Privacy' }}</span>
      </div>
      <div class="welcome-cap">
        <span class="cap-icon">⚡</span>
        <span class="cap-label">Intel NPU</span>
      </div>
      <div class="welcome-cap">
        <span class="cap-icon">🎤</span>
        <span class="cap-label">{{ locale === 'zh-CN' ? '语音/图片 (即将推出)' : 'Voice/Image Soon' }}</span>
      </div>
    </div>
  </div>
</template>
