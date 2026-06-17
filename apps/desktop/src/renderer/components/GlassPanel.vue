<!-- apps/desktop/src/renderer/components/GlassPanel.vue -->
<script setup lang="ts">
defineProps<{ size?: 's' | 'm' | 'l' }>();
</script>
<template>
  <div
    class="border border-glass-border bg-glass-bg backdrop-blur-glass"
    :class="size === 'l' ? 'rounded-panel' : size === 's' ? 'rounded-card' : 'rounded-panel'"
    style="box-shadow: var(--ds-glass-shadow)"
  >
    <slot />
  </div>
</template>
