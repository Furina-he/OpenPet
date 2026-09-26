<!-- components/memory/MemoryProbeResult.vue — ㉒「试一句」结果侧栏（spec §4.6）：会想起的页（路线徽标 +
     向量相似度 + 字数）/ 共注入字数与预算 / 折叠的注入原文（所见即所注入）。 -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { MemoryProbeResult } from '@openpet/protocol';

defineProps<{ result: MemoryProbeResult }>();
const emit = defineEmits<{ select: [string] }>();
const { t } = useI18n();
const routeLabel = (via: 'keyword' | 'vector'): string =>
  t(via === 'keyword' ? 'settings.memory.graph.probeKeyword' : 'settings.memory.graph.probeVector');
</script>

<template>
  <div
    class="ds-glass flex max-h-full min-h-0 flex-col rounded-panel p-3 text-xs text-text-main"
  >
    <div class="font-semibold">{{ t('settings.memory.graph.probeWill') }}</div>
    <div class="mt-1 flex flex-col gap-0.5 overflow-y-auto">
      <div v-for="r in result.resident" :key="r.title" class="flex items-center gap-2 px-1 py-0.5">
        <span class="rounded-full border border-glass-border px-1.5 text-text-sub">{{
          t('settings.memory.graph.probeResident')
        }}</span>
        <span class="truncate">{{ r.title }}</span>
        <span class="ml-auto text-text-sub">{{ r.chars }}</span>
      </div>
      <button
        v-for="p in result.pages"
        :key="p.path"
        class="ds-focus flex items-center gap-2 rounded-btn px-1 py-0.5 text-left hover:bg-glass-border"
        @click="emit('select', p.path)"
      >
        <span
          class="rounded-full px-1.5 text-white"
          :style="{
            background: p.via === 'keyword' ? 'var(--ds-brand-to)' : 'var(--ds-cool)',
          }"
          >{{ routeLabel(p.via) }}</span
        >
        <span class="truncate">{{ p.title }}</span>
        <span v-if="p.score !== undefined" class="text-text-sub">{{ p.score.toFixed(2) }}</span>
        <span class="ml-auto text-text-sub">{{ p.chars }}</span>
      </button>
    </div>
    <div v-if="result.pages.length === 0" class="mt-1 text-text-sub">
      {{ t('settings.memory.graph.probeNone') }}
    </div>
    <div class="mt-2 text-text-sub">
      {{ t('settings.memory.graph.probeInjected', { n: result.injectedChars, budget: result.budget }) }}
    </div>
    <details v-if="result.preview" class="mt-1">
      <summary class="cursor-pointer text-text-sub">
        {{ t('settings.memory.graph.probeRaw') }}
      </summary>
      <pre
        class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-input p-2 font-mono"
        style="background: var(--ds-surface-soft)"
        >{{ result.preview }}</pre
      >
    </details>
  </div>
</template>
