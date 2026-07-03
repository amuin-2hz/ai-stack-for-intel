<script setup lang="ts">
defineProps<{
  percent: number;
  size?: number;
  strokeWidth?: number;
}>();

function dashOffset(percent: number): number {
  const circumference = 263.89;
  const clamped = Math.min(100, Math.max(0, percent));
  return circumference * (1 - clamped / 100);
}
</script>

<template>
  <div class="gauge-ring" :style="{ width: (size || 80) + 'px', height: (size || 80) + 'px' }">
    <svg viewBox="0 0 100 100">
      <circle class="gauge-bg" cx="50" cy="50" r="42" />
      <circle
        class="gauge-fill"
        cx="50"
        cy="50"
        r="42"
        :stroke-width="strokeWidth || 6"
        stroke-dasharray="263.89"
        :stroke-dashoffset="dashOffset(percent)"
      />
    </svg>
    <div class="gauge-inner">
      <slot>
        <strong style="font-size:.85rem">{{ Math.round(percent) }}%</strong>
      </slot>
    </div>
  </div>
</template>
