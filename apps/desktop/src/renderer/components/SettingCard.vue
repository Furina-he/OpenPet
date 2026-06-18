<!-- apps/desktop/src/renderer/components/SettingCard.vue -->
<!-- §7.1 卡片行：左 Label+Description，右控件（slot）。 -->
<script setup lang="ts">
defineProps<{ label: string; description?: string; indent?: boolean }>();
</script>
<template>
  <div class="flex items-center justify-between gap-4 py-3" :class="indent ? 'pl-8 pr-4' : 'px-4'">
    <div class="min-w-0">
      <div class="text-base text-text-main">{{ label }}</div>
      <div v-if="description" class="text-sm text-text-sub">{{ description }}</div>
    </div>
    <div class="shrink-0"><slot /></div>
  </div>
</template>
