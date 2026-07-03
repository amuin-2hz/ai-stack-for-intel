<script setup lang="ts">
defineProps<{
  label: string;
  value: string | number;
}>();
</script>

<template>
  <div class="statCard">
    <span>{{ label }}</span>
    <strong>{{ value }}</strong>
  </div>
</template>
