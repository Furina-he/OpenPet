<!-- apps/desktop/src/renderer/components/SettingSection.vue -->
<!-- §7.1：同主题项放一组卡片（圆角 12、内分隔线）；危险/实验区传 tone="warn" 走警告描边。 -->
<script setup lang="ts">
defineProps<{ title: string; description?: string; tone?: 'default' | 'warn' | 'danger' }>();
</script>
<template>
  <section
    class="ds-glass mb-4 overflow-hidden rounded-panel"
    :class="{
      'border-warning': tone === 'warn',
      'border-danger': tone === 'danger',
    }"
  >
    <header class="flex items-start gap-3 px-4 pb-2 pt-4">
      <span
        class="mt-0.5 h-6 w-1 rounded-full"
        :style="
          tone === 'danger'
            ? 'background: var(--ds-danger)'
            : tone === 'warn'
              ? 'background: var(--ds-warning)'
              : 'background: linear-gradient(180deg, var(--ds-brand-from), var(--ds-brand-to))'
        "
      />
      <span class="min-w-0">
        <span class="block text-md font-medium text-text-main">{{ title }}</span>
        <span v-if="description" class="mt-1 block text-sm text-text-sub">{{ description }}</span>
      </span>
    </header>
    <div class="divide-y divide-glass-border">
      <slot />
    </div>
  </section>
</template>
