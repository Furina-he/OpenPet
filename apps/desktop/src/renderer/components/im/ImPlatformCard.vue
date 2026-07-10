<!-- components/im/ImPlatformCard.vue — IM 平台卡片（照 AstrBot ItemCard，形制同 ProviderCard）：
     名 + 类型·端点副行 + 启用开关 + 平台 logo 水印 + 状态 chip（AstrBot 口径：running 不显示）
     + 错误次数 chip（errorCount>0 时亮起，点开错误详情）+ 删除/编辑。 -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, type Component } from 'vue';
import { AlertCircle, Bug, Clock, RefreshCw, StopCircle } from 'lucide-vue-next';
import type { ImPlatform, ImStatus } from '@openpet/protocol';
import { IM_PLATFORM_META } from './platform-meta';

const { t } = useI18n();
const props = defineProps<{ platform: ImPlatform; status?: ImStatus }>();
const emit = defineEmits<{ toggle: [boolean]; edit: []; remove: []; errors: [] }>();

const meta = computed(() => IM_PLATFORM_META[props.platform.type]);
const errorCount = computed(() => props.status?.errorCount ?? 0);

// AstrBot 口径：running 不显示状态 chip；其余状态按色/图标显示（hover 出最近错误）。
const chip = computed<{ label: string; color: string; icon: Component } | null>(() => {
  const s = props.status;
  if (!props.platform.enable)
    return { label: t('settings.im.statusStopped'), color: 'var(--ds-text-sub)', icon: StopCircle };
  if (!s || s.status === 'running') return null;
  switch (s.status) {
    case 'reconnecting':
      return { label: t('settings.im.statusReconnecting'), color: 'var(--ds-warning)', icon: RefreshCw };
    case 'error':
      return { label: t('settings.im.statusError'), color: 'var(--ds-danger)', icon: AlertCircle };
    case 'pending':
      return { label: t('settings.im.statusPending'), color: 'var(--ds-warning)', icon: Clock };
    default:
      return { label: t('settings.im.statusStopped'), color: 'var(--ds-text-sub)', icon: StopCircle };
  }
});
</script>

<template>
  <div
    class="ds-glass relative flex min-h-[190px] flex-col overflow-hidden rounded-panel p-5 transition ease-ds hover:-translate-y-0.5"
  >
    <!-- 平台 logo 水印（照 AstrBot bglogo） -->
    <img
      :src="meta.logo"
      class="pointer-events-none absolute -right-2 top-1/2 h-28 w-28 -translate-y-1/2 object-contain opacity-10"
      alt=""
    />

    <div class="relative flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <div class="truncate text-md font-bold text-text-main" :title="platform.name">
          {{ platform.name }}
        </div>
        <div class="mt-0.5 truncate text-sm text-text-sub">
          {{ meta.label }}<template v-if="meta.endpointOf(platform)"> · {{ meta.endpointOf(platform) }}</template>
        </div>
      </div>
      <button
        role="switch"
        :aria-checked="platform.enable"
        class="relative h-7 w-12 shrink-0 rounded-full transition ease-ds"
        :style="
          platform.enable
            ? 'background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))'
            : 'background: rgba(23,24,33,0.12)'
        "
        @click="emit('toggle', !platform.enable)"
      >
        <span
          class="absolute top-0.5 h-6 w-6 rounded-full bg-white transition ease-ds"
          :style="platform.enable ? 'left: 22px' : 'left: 2px'"
        />
      </button>
    </div>

    <div v-if="chip || errorCount > 0" class="relative mt-3 flex flex-wrap items-center gap-2">
      <span
        v-if="chip"
        class="flex items-center gap-1 rounded-full px-2 py-0.5 text-sm"
        :style="{ color: chip.color, background: 'var(--ds-warm-soft)' }"
        :title="status?.lastError ?? ''"
      >
        <component :is="chip.icon" :size="13" :stroke-width="1.5" />
        {{ chip.label }}
      </span>
      <button
        v-if="errorCount > 0"
        class="flex items-center gap-1 rounded-full px-2 py-0.5 text-sm transition hover:opacity-80"
        style="color: var(--ds-danger); background: var(--ds-warm-soft)"
        @click="emit('errors')"
      >
        <Bug :size="13" :stroke-width="1.5" />
        {{ t('settings.im.errorTimes', { n: errorCount }) }}
      </button>
    </div>

    <div class="relative mt-auto flex flex-wrap items-center gap-2 pt-6">
      <button
        class="rounded-full border px-3 py-1 text-sm transition"
        style="color: var(--ds-danger); border-color: var(--ds-danger)"
        @click="emit('remove')"
      >
        {{ t('common.delete') }}
      </button>
      <button
        class="rounded-full border border-glass-border px-3 py-1 text-sm text-text-main transition hover:border-brand-to"
        @click="emit('edit')"
      >
        {{ t('common.edit') }}
      </button>
    </div>
  </div>
</template>
