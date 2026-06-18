<!-- apps/desktop/src/renderer/components/SettingSection.vue -->
<!-- §7.1：同主题项放一组卡片（圆角 12、内分隔线）；§7.4 危险/实验区传 tone="warn" 走警告描边。 -->
<script setup lang="ts">
defineProps<{ title: string; tone?: 'default' | 'warn' }>();
</script>
<template>
  <section
    class="ds-glass mb-4 overflow-hidden rounded-card"
    :class="tone === 'warn' ? 'border-warning' : ''"
  >
    <header class="px-4 pt-3 text-sm text-text-sub">{{ title }}</header>
    <!-- 行间分隔线：子项用 SettingCard，靠 divide 工具类描边 -->
    <div class="divide-y" style="--tw-divide-opacity: 1; border-color: rgba(127, 127, 127, 0.12)">
      <slot />
    </div>
  </section>
</template>
