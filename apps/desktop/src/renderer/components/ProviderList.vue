<!-- components/ProviderList.vue — §7.3 左栏 provider 列表 + 状态点（绿可用/灰待填Key/红测失败） -->
<script setup lang="ts">
import { providerDot, DOT_COLOR } from '../settings/provider-status';

interface Row {
  id: string;
  name: string;
  model: string;
  hasKey: boolean;
  lastTestOk?: boolean | null;
}
const props = defineProps<{ rows: Row[]; activeId: string }>();
const emit = defineEmits<{ select: [id: string] }>();
</script>

<template>
  <div class="flex flex-col gap-1">
    <button
      v-for="r in props.rows"
      :key="r.id"
      class="relative flex min-h-[64px] items-center gap-3 rounded-card border px-3 py-2 text-left transition ease-ds"
      :class="r.id === props.activeId ? 'text-text-main' : 'text-text-sub'"
      :style="
        r.id === props.activeId
          ? 'background: var(--ds-warm-soft); border-color: rgba(255,143,171,0.45)'
          : 'background: var(--ds-surface-soft); border-color: var(--ds-glass-border)'
      "
      @click="emit('select', r.id)"
    >
      <span
        class="h-9 w-9 shrink-0 rounded-card border border-glass-border text-center text-sm font-semibold leading-9"
        :style="
          r.id === props.activeId
            ? 'background: rgba(255,180,162,0.36)'
            : 'background: var(--ds-surface-strong)'
        "
      >
        {{ r.name.slice(0, 2) }}
      </span>
      <span
        class="absolute left-10 top-10 h-2 w-2 rounded-full"
        :style="`background: ${DOT_COLOR[providerDot(r)]}`"
      />
      <span class="min-w-0 flex-1">
        <span class="block truncate text-base font-medium">{{ r.name }}</span>
        <span v-if="r.model" class="block truncate text-sm text-text-sub">{{ r.model }}</span>
      </span>
      <span
        v-if="r.id === props.activeId"
        class="rounded-btn border px-2 py-0.5 text-xs"
        style="border-color: rgba(255, 143, 171, 0.42); color: #c87240"
      >
        默认
      </span>
    </button>
  </div>
</template>
