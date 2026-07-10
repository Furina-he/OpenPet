<!-- apps/desktop/src/renderer/overlay/components/EmotionChip.vue — B2 双轨：情绪小 chip（暖色） -->
<script setup lang="ts">
defineProps<{ label: string }>();
</script>
<template>
  <span
    class="inline-flex items-center rounded-full px-2 py-0.5 text-sm text-white"
    style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
  >
    {{ label }}
  </span>
</template>
