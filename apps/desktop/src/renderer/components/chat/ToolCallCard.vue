<!-- apps/desktop/src/renderer/components/chat/ToolCallCard.vue
     Hub 工具调用卡（C′ §3b，照 AstrBot message_list_comps/ToolCallCard）。
     pending/result/error 三态 + 可折叠详情（args / result）。冷色系（工具=技术动作）。 -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Check, ChevronDown, ChevronRight, Wrench, X } from 'lucide-vue-next';

const props = defineProps<{
  call: {
    id: string;
    name: string;
    args?: unknown;
    phase: 'pending' | 'result' | 'error';
    result?: string;
  };
}>();

const { t } = useI18n();
const open = ref(false);

const PHASE_LABEL = computed<Record<'pending' | 'result' | 'error', string>>(() => ({
  pending: t('settings.toolCall.pending'),
  result: t('settings.toolCall.done'),
  error: t('settings.toolCall.error'),
}));

function pretty(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
</script>

<template>
  <div
    class="rounded-card border text-sm"
    style="border-color: var(--ds-cool-soft); background: var(--ds-cool-soft)"
  >
    <button class="flex w-full items-center gap-2 px-3 py-2 text-left" @click="open = !open">
      <span
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white"
        style="background: var(--ds-cool)"
      >
        <Wrench :size="13" :stroke-width="1.75" />
      </span>
      <span class="min-w-0 flex-1 truncate font-medium text-text-main">{{ call.name }}</span>

      <!-- 三态徽标 -->
      <span v-if="props.call.phase === 'pending'" class="flex items-center gap-1.5 text-text-sub">
        <span class="h-1.5 w-1.5 animate-pulse rounded-full" style="background: var(--ds-cool)" />
        {{ PHASE_LABEL.pending }}
      </span>
      <span
        v-else-if="props.call.phase === 'result'"
        class="flex items-center gap-1"
        style="color: var(--ds-text-main)"
      >
        <Check :size="14" :stroke-width="2" style="color: var(--ds-success)" />
        {{ PHASE_LABEL.result }}
      </span>
      <span v-else class="flex items-center gap-1" style="color: var(--ds-danger)">
        <X :size="14" :stroke-width="2" />
        {{ PHASE_LABEL.error }}
      </span>

      <component
        :is="open ? ChevronDown : ChevronRight"
        :size="15"
        :stroke-width="1.5"
        class="text-text-sub"
      />
    </button>

    <div v-if="open" class="border-t px-3 py-2" style="border-color: var(--ds-glass-border)">
      <div v-if="pretty(call.args)" class="mb-2">
        <div class="mb-1 text-xs text-text-sub">{{ t('settings.toolCall.args') }}</div>
        <pre
          class="overflow-x-auto whitespace-pre-wrap break-words rounded-btn bg-white/40 p-2 font-mono text-xs text-text-main"
          >{{ pretty(call.args) }}</pre
        >
      </div>
      <div v-if="call.result">
        <div class="mb-1 text-xs text-text-sub">{{ t('settings.toolCall.result') }}</div>
        <pre
          class="overflow-x-auto whitespace-pre-wrap break-words rounded-btn bg-white/40 p-2 font-mono text-xs text-text-main"
          >{{ call.result }}</pre
        >
      </div>
      <div v-else-if="call.phase === 'pending'" class="text-xs text-text-sub">{{ t('settings.toolCall.waiting') }}</div>
    </div>
  </div>
</template>
