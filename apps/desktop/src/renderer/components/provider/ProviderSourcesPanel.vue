<!-- components/provider/ProviderSourcesPanel.vue — Provider 工作台左栏：source 列表
     props.sources 已由父按能力 tab 过滤。对齐 AstrBot ProviderSourcesPanel + §2 glass token。 -->
<script setup lang="ts">
import type { ProviderSource } from '@desksoul/protocol';

defineProps<{ sources: ProviderSource[]; activeSourceId: string }>();
const emit = defineEmits<{ select: [id: string]; add: []; remove: [id: string] }>();
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex-1 space-y-1 overflow-auto">
      <div
        v-for="s in sources"
        :key="s.id"
        class="group flex w-full cursor-pointer items-center gap-2 rounded-card px-3 py-2 transition"
        :class="
          s.id === activeSourceId
            ? 'ds-glass border border-brand-to'
            : 'border border-transparent hover:border-glass-border'
        "
        @click="emit('select', s.id)"
      >
        <span
          class="h-2 w-2 shrink-0 rounded-full"
          :style="{ background: s.enabled ? 'var(--ds-success)' : 'var(--ds-text-sub)' }"
        />
        <span class="min-w-0 flex-1">
          <span class="block truncate font-semibold text-text-main">{{ s.id }}</span>
          <span class="block truncate text-sm text-text-sub">{{ s.adapter }}</span>
        </span>
        <button
          class="hidden text-sm text-text-sub group-hover:inline"
          title="移除该源"
          @click.stop="emit('remove', s.id)"
        >
          移除
        </button>
      </div>
      <div v-if="!sources.length" class="px-3 py-6 text-center text-sm text-text-sub">
        还没有提供商源
      </div>
    </div>
    <button
      class="mt-2 rounded-btn border border-glass-border px-3 py-2 text-base text-text-main transition hover:border-brand-to"
      @click="emit('add')"
    >
      ＋ 新增提供商源
    </button>
  </div>
</template>
