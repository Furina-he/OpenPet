<!-- components/kb/KbCard.vue — 单个知识库卡片（§5，照 AstrBot KB 卡 + §2 glass）。
     emoji/名/doc·chunk 数 + active 开关 + 删除；点卡片选中看文档。 -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { Kb } from '@openpet/protocol';
import Switch from '../Switch.vue';

const { t } = useI18n();
const props = defineProps<{ kb: Kb; selected: boolean }>();
const emit = defineEmits<{ select: []; toggle: [boolean]; delete: [] }>();
</script>

<template>
  <button
    class="ds-glass flex w-full items-center gap-3 rounded-panel p-4 text-left transition ease-ds"
    :style="props.selected ? 'outline: 2px solid var(--ds-brand-to); outline-offset: -1px' : ''"
    @click="emit('select')"
  >
    <span
      class="grid h-11 w-11 shrink-0 place-items-center rounded-card text-xl"
      style="background: var(--ds-warm-soft)"
    >
      {{ props.kb.emoji }}
    </span>
    <div class="min-w-0 flex-1">
      <div class="truncate font-semibold text-text-main">{{ props.kb.name }}</div>
      <div class="truncate text-sm text-text-sub">
        {{ t('settings.kb.cardCounts', { docs: props.kb.docCount, chunks: props.kb.chunkCount }) }}
      </div>
    </div>
    <!-- @click.stop：开关/删除不触发选中 -->
    <span class="flex items-center gap-2" @click.stop>
      <Switch :model-value="props.kb.active" @update:model-value="(v) => emit('toggle', v)" />
      <button
        class="text-sm text-text-sub hover:text-text-main"
        :title="t('settings.kb.confirmDeleteKbTitle')"
        :aria-label="t('settings.kb.confirmDeleteKbTitle')"
        @click="emit('delete')"
      >
        {{ t('common.delete') }}
      </button>
    </span>
  </button>
</template>
