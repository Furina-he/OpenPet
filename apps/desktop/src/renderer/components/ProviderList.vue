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
      class="flex items-center gap-2 rounded-btn px-3 py-2 text-left"
      :class="r.id === props.activeId ? 'text-text-main' : 'text-text-sub'"
      :style="r.id === props.activeId ? 'background: var(--ds-glass-border)' : ''"
      @click="emit('select', r.id)"
    >
      <span
        class="h-2 w-2 shrink-0 rounded-full"
        :style="`background: ${DOT_COLOR[providerDot(r)]}`"
      />
      <span class="min-w-0 flex-1">
        <span class="block truncate text-base">{{ r.name }}</span>
        <span v-if="r.model" class="block truncate text-sm text-text-sub">{{ r.model }}</span>
      </span>
    </button>
  </div>
</template>
