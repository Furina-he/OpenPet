<!-- settings/pages/TracePage.vue — Hub「系统→诊断」页（§7，照 AstrBot TracePage/TraceDisplayer + §2 glass）。
     按 span 分组的时间线表（行=一轮，展开=records）；Recording/Paused 开关写 trace.enabled；
     进页拉 trace.history，on('trace.record') 实时插入。分组逻辑下沉 trace-view.ts。 -->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TraceRecord } from '@openpet/protocol';
import Button from '../../components/Button.vue';
import Switch from '../../components/Switch.vue';
import { groupHistory, upsertRecord, formatFields, type TraceSpanGroup } from '../trace-view.js';

const { t } = useI18n();
const groups = ref<TraceSpanGroup[]>([]);
const expanded = ref<Set<string>>(new Set());
const recording = ref(true);
let off: (() => void) | null = null;

onMounted(async () => {
  const prefs = await window.openpet.rpc('app.prefs.getAll', {});
  recording.value = prefs['trace.enabled'];
  const h = await window.openpet.rpc('trace.history', {});
  groups.value = groupHistory(h.records);
  off = window.openpet.on('trace.record', (p) => {
    groups.value = upsertRecord(groups.value, p as TraceRecord);
  });
});
onUnmounted(() => off?.());

function toggle(spanId: string): void {
  const next = new Set(expanded.value);
  if (next.has(spanId)) next.delete(spanId);
  else next.add(spanId);
  expanded.value = next;
}
async function setRecording(v: boolean): Promise<void> {
  recording.value = v;
  await window.openpet.rpc('app.prefs.set', { key: 'trace.enabled', value: v });
}
async function clearAll(): Promise<void> {
  await window.openpet.rpc('trace.clear', {});
  groups.value = [];
}
function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleTimeString()}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}
</script>

<template>
  <div class="space-y-6">
    <section class="ds-glass rounded-panel p-5">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-md font-semibold text-text-main">{{ t('settings.trace.title') }}</h2>
        <div class="flex items-center gap-3">
          <span class="flex items-center gap-2 text-sm text-text-sub">
            <span
              class="h-1.5 w-1.5 rounded-full"
              :style="{ background: recording ? 'var(--ds-success)' : 'var(--ds-text-sub)' }"
            />
            {{ recording ? 'Recording' : 'Paused' }}
            <Switch :model-value="recording" @update:model-value="setRecording" />
          </span>
          <Button variant="secondary" @click="clearAll">{{ t('settings.data.clearLabel') }}</Button>
        </div>
      </div>

      <div v-if="!groups.length" class="px-3 py-8 text-center text-sm text-text-sub">
        {{ t('settings.trace.empty') }}
      </div>

      <template v-else>
        <div
          class="grid grid-cols-[140px_1fr_72px_48px] items-center gap-2 border-b border-glass-border px-2 py-2 text-sm text-text-sub"
        >
          <span>{{ t('settings.trace.time') }}</span>
          <span>{{ t('settings.trace.outline') }}</span>
          <span class="text-right">{{ t('settings.trace.recordCount') }}</span>
          <span />
        </div>
        <template v-for="g in groups" :key="g.spanId">
          <button
            class="grid w-full grid-cols-[140px_1fr_72px_48px] items-center gap-2 border-b border-glass-border px-2 py-2 text-left text-sm transition ease-ds hover:bg-white/30"
            @click="toggle(g.spanId)"
          >
            <span class="text-text-sub">{{ fmtTime(g.firstTs) }}</span>
            <span class="truncate text-text-main">
              {{ g.outline || g.spanId.slice(0, 8) }}
            </span>
            <span class="text-right text-text-sub">{{ g.records.length }}</span>
            <span class="text-right text-text-sub">{{ expanded.has(g.spanId) ? '▾' : '▸' }}</span>
          </button>
          <div
            v-if="expanded.has(g.spanId)"
            class="border-b border-glass-border bg-white/20 px-3 py-2"
          >
            <div v-for="(r, i) in g.records" :key="i" class="flex items-start gap-3 py-1 text-sm">
              <span class="w-[130px] shrink-0 text-text-sub">{{ fmtTime(r.ts) }}</span>
              <span class="w-[160px] shrink-0 font-medium text-text-main">{{ r.action }}</span>
              <pre
                v-if="r.fields"
                class="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all text-xs text-text-sub"
                >{{ formatFields(r.fields) }}</pre
              >
            </div>
          </div>
        </template>
      </template>
    </section>
  </div>
</template>
