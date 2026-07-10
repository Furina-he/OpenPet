<!-- settings/pages/OverviewPage.vue — 总览页（spec 2026-07-09，布局 A：左模型立柱+右统计）。
     数据源 app.stats.overview + character.current，60s 自动刷新；字段零硬编码。 -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import VueApexCharts from 'vue3-apexcharts';
import type { z } from 'zod';
import type { Methods } from '@openpet/protocol';
import ModelShowcase from '../components/ModelShowcase.vue';
import {
  greetSlot,
  formatInt,
  formatCompact,
  formatUptime,
  formatMemoryMb,
  readPalette,
  areaChartConfig,
  stackedTokenConfig,
} from '../overview-view.js';

const apexchart = VueApexCharts;
type Stats = z.infer<(typeof Methods)['app.stats.overview']['result']>;
type Current = z.infer<(typeof Methods)['character.current']['result']>;

const emit = defineEmits<{ navigate: [route: string] }>();
const { t } = useI18n();
const stats = ref<Stats | null>(null);
const current = ref<Current | null>(null);
const range = ref<1 | 3 | 7>(7);
const refreshedAt = ref('');
let timer: ReturnType<typeof setInterval> | null = null;
let seq = 0;

async function refresh(): Promise<void> {
  const my = ++seq;
  const [s, c] = await Promise.all([
    window.openpet.rpc('app.stats.overview', { rangeDays: range.value }),
    window.openpet.rpc('character.current', {}),
  ]);
  if (my !== seq) return; // range 竞态守卫：只采纳最后一次
  stats.value = s;
  current.value = c;
  refreshedAt.value = new Date().toLocaleTimeString();
}
function setRange(v: 1 | 3 | 7): void {
  range.value = v;
  void refresh();
}
onMounted(() => {
  void refresh();
  timer = setInterval(() => void refresh(), 60_000);
  window.openpet.on('character.changed', () => void refresh());
  // 换肤后 CSS 变量已由 subscribeTheme 应用——延迟一拍重读色板，图表色跟随。
  window.openpet.on('app.prefs.changed', (p) => {
    if ((p as { key?: string }).key === 'display.theme') {
      setTimeout(() => {
        palette.value = readPalette();
      }, 50);
    }
  });
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});

const palette = ref(readPalette());
const messageChart = computed(() =>
  areaChartConfig(
    palette.value,
    stats.value?.messageSeries ?? [],
    t('settings.overview.chart.messageTrend'),
  ),
);
const tokenChart = computed(() =>
  stackedTokenConfig(
    palette.value,
    stats.value?.tokenSeries ?? [],
    '__others__',
    t('settings.overview.chart.others'),
  ),
);
const hasMessages = computed(() => (stats.value?.messageSeries ?? []).length > 0);

const kpis = computed(() => {
  const k = stats.value?.kpi;
  return [
    { label: t('settings.overview.kpi.monthMessages'), value: formatInt(k?.monthMessages ?? 0) },
    { label: t('settings.overview.kpi.monthTokens'), value: formatCompact(k?.monthTokens ?? 0) },
    { label: t('settings.overview.kpi.memory'), value: formatMemoryMb(k?.memoryMb ?? 0) },
    { label: t('settings.overview.kpi.uptime'), value: formatUptime(k?.uptimeSec ?? 0) },
  ];
});
const greeting = computed(() => t(`settings.overview.greeting.${greetSlot(new Date().getHours())}`));
function channelStatus(c: { connected: boolean; error: string | null }): { key: string; ok: boolean } {
  if (c.connected) return { key: 'settings.overview.eco.connected', ok: true };
  return { key: c.error ? 'settings.overview.eco.error' : 'settings.overview.eco.disconnected', ok: false };
}
</script>

<template>
  <div class="flex h-full min-h-0 gap-4">
    <!-- 左柱：模型展示（ModelShowcase 于 T7 接入） -->
    <div class="flex w-[280px] shrink-0 flex-col gap-4">
      <ModelShowcase
        v-if="current && stats"
        :character-id="current.characterId"
        :manifest="current.manifest"
        :companion-days="stats.companionDays"
        class="cursor-pointer"
        @click="emit('navigate', 'character.library')"
      />
      <div v-else class="ds-glass flex flex-1 items-center justify-center rounded-panel p-4 text-text-sub">
        {{ current?.manifest.name ?? '…' }}
      </div>
      <button
        class="ds-glass rounded-panel p-3 text-center text-sm font-semibold transition ease-ds hover:-translate-y-0.5"
        style="color: var(--ds-brand-to)"
        @click="emit('navigate', 'character.library')"
      >
        {{ t('settings.overview.model.goLibrary') }} →
      </button>
    </div>

    <!-- 右侧统计流 -->
    <div class="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      <div class="flex items-baseline justify-between px-1">
        <div>
          <span class="text-lg font-semibold text-text-main">{{ greeting }}</span>
          <span v-if="stats && current" class="ml-3 text-sm text-text-sub">
            {{ t('settings.overview.todayLine', { name: current.manifest.name, n: stats.todayMessages }) }}
          </span>
        </div>
        <span class="text-xs text-text-sub">{{ t('settings.overview.refreshedAt', { time: refreshedAt }) }}</span>
      </div>

      <div class="grid grid-cols-4 gap-4">
        <div v-for="k in kpis" :key="k.label" class="ds-glass rounded-panel p-4">
          <div class="text-sm text-text-sub">{{ k.label }}</div>
          <div class="mt-1 text-xl font-semibold text-text-main">{{ k.value }}</div>
        </div>
      </div>

      <!-- 消息趋势卡（图表于 T6 填充） -->
      <div class="ds-glass rounded-panel p-5" data-slot="message-trend">
        <div class="mb-2 flex items-center justify-between">
          <div>
            <span class="text-sm font-semibold text-text-main">{{ t('settings.overview.chart.messageTrend') }}</span>
            <span class="ml-2 text-xs text-text-sub">{{ t('settings.overview.chart.messageTrendSub') }}</span>
          </div>
          <div class="flex gap-1 rounded-full border border-glass-border p-1">
            <button
              v-for="opt in ([1, 3, 7] as const)"
              :key="opt"
              class="rounded-full px-3 py-1 text-xs transition ease-ds"
              :class="range === opt ? 'font-semibold' : 'text-text-sub'"
              :style="range === opt ? 'background: var(--ds-warm-soft); color: var(--ds-brand-to)' : ''"
              @click="setRange(opt)"
            >
              {{ t(`settings.overview.range.d${opt}`) }}
            </button>
          </div>
        </div>
        <apexchart
          v-if="hasMessages"
          type="area"
          height="220"
          :options="messageChart.options"
          :series="messageChart.series"
        />
        <div v-else class="flex h-[220px] items-center justify-center text-sm text-text-sub">
          {{ t('settings.overview.chart.empty') }}
        </div>
      </div>

      <div class="flex items-stretch gap-4">
        <!-- Token 卡（图表于 T6 填充） -->
        <div class="ds-glass min-w-0 flex-[1.35] rounded-panel p-5">
          <div class="mb-2 text-sm font-semibold text-text-main">{{ t('settings.overview.chart.tokenByModel') }}</div>
          <apexchart
            v-if="(stats?.tokenSeries ?? []).length"
            type="bar"
            height="200"
            :options="tokenChart.options"
            :series="tokenChart.series"
          />
          <div v-else class="flex h-[120px] items-center justify-center text-sm text-text-sub">
            {{ t('settings.overview.chart.empty') }}
          </div>
          <div v-if="stats" class="mt-2">
            <div
              v-for="row in stats.tokensByModel.slice(0, 5)"
              :key="row.model"
              class="flex items-center justify-between border-b border-glass-border py-1.5 text-sm last:border-0"
            >
              <span class="truncate text-text-main">{{ row.model }}</span>
              <span class="shrink-0 font-medium text-text-main">{{ formatCompact(row.tokens) }}</span>
            </div>
          </div>
        </div>
        <div class="ds-glass min-w-0 flex-1 rounded-panel p-5">
          <div class="mb-2 text-sm font-semibold text-text-main">{{ t('settings.overview.eco.title') }}</div>
          <template v-if="stats">
            <div v-if="stats.channels.length === 0" class="py-1 text-sm text-text-sub">
              {{ t('settings.overview.eco.noChannels') }}
            </div>
            <div
              v-for="c in stats.channels"
              :key="c.id"
              class="flex items-center justify-between border-b border-glass-border py-2 text-sm last:border-0"
            >
              <span class="truncate text-text-main">{{ c.name }}</span>
              <span
                class="flex shrink-0 items-center gap-1.5"
                :style="{ color: channelStatus(c).ok ? 'var(--ds-success)' : 'var(--ds-text-sub)' }"
              >
                <span
                  class="h-1.5 w-1.5 rounded-full"
                  :style="{ background: channelStatus(c).ok ? 'var(--ds-success)' : 'var(--ds-glass-border)' }"
                />
                {{ t(channelStatus(c).key) }}
              </span>
            </div>
            <div class="flex items-center justify-between border-b border-glass-border py-2 text-sm">
              <span class="text-text-main">{{ t('settings.overview.eco.mcpTools') }}</span>
              <span class="font-medium text-text-main">{{ t('settings.overview.eco.mcpToolsValue', { n: stats.mcpToolCount }) }}</span>
            </div>
            <div class="flex items-center justify-between py-2 text-sm">
              <span class="text-text-main">{{ t('settings.overview.eco.plugins') }}</span>
              <span class="font-medium text-text-main">
                {{ t('settings.overview.eco.pluginsValue', { enabled: stats.pluginEnabled, total: stats.pluginTotal }) }}
              </span>
            </div>
            <button
              class="mt-1 flex w-full items-center justify-between py-1 text-sm font-semibold"
              style="color: var(--ds-brand-to)"
              @click="emit('navigate', 'connections')"
            >
              <span>{{ t('settings.overview.eco.manage') }}</span><span>→</span>
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
