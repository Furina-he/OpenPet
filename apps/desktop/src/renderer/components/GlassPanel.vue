<!-- apps/desktop/src/renderer/components/GlassPanel.vue -->
<script setup lang="ts">
defineProps<{ size?: 's' | 'm' | 'l' }>();
</script>
<template>
  <div
    class="ds-glass"
    :class="size === 'l' ? 'rounded-panel' : size === 's' ? 'rounded-card' : 'rounded-panel'"
  >
    <slot />
  </div>
</template>
