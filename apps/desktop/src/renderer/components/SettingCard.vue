<!-- apps/desktop/src/renderer/components/SettingCard.vue -->
<!-- §7.1 卡片行：左 Label+Description，右控件（slot）。 -->
<script setup lang="ts">
defineProps<{ label: string; description?: string; indent?: boolean }>();
</script>
<template>
  <div
    class="flex min-h-[60px] items-center justify-between gap-4 py-3"
    :class="indent ? 'pl-10 pr-4' : 'px-4'"
  >
    <div class="min-w-0">
      <div class="text-base font-medium text-text-main">{{ label }}</div>
      <div v-if="description" class="mt-0.5 max-w-[36rem] text-sm leading-relaxed text-text-sub">
        {{ description }}
      </div>
    </div>
    <div class="flex shrink-0 items-center justify-end"><slot /></div>
  </div>
</template>
