<!-- components/plugins/PluginCard.vue — 插件卡片（照 AstrBot ExtensionPage 信息结构 + glass token）。
     Desktop/Star 两运行时共用：logo 占位/名/版本/作者/描述/状态 chip/enable Switch/
     配置(hasConfig 才亮)/重载(reloadable)/卸载；Star 的命令列表经 commands 展示为 chip（T7）。 -->
<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RotateCw, Settings2, Trash2 } from 'lucide-vue-next';
import Switch from '../Switch.vue';

const props = defineProps<{
  name: string;
  version: string;
  author: string;
  description: string;
  enabled: boolean;
  status: 'running' | 'restarting' | 'disabled' | 'error';
  lastError?: string;
  hasConfig?: boolean;
  reloadable?: boolean;
  commands?: string[];
}>();
const emit = defineEmits<{
  toggle: [boolean];
  configure: [];
  reload: [];
  uninstall: [];
}>();
const { t } = useI18n();

const statusColor = computed(
  () =>
    ({
      running: 'var(--ds-success)',
      restarting: 'var(--ds-warning)',
      error: 'var(--ds-danger)',
      disabled: 'var(--ds-text-sub)',
    })[props.status],
);
const statusLabel = computed(() => t(`settings.plugins.status.${props.status}`));
</script>
<template>
  <div class="ds-glass relative overflow-hidden rounded-panel p-4">
    <!-- logo 水印占位（首字母，照 im 卡片手法） -->
    <span
      class="pointer-events-none absolute -right-3 -top-5 select-none text-[84px] font-bold leading-none opacity-[0.07]"
      aria-hidden="true"
    >
      {{ name.slice(0, 1).toUpperCase() }}
    </span>

    <div class="flex items-start gap-3">
      <span class="ds-avatar h-10 w-10 shrink-0 text-base">{{ name.slice(0, 1).toUpperCase() }}</span>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="truncate font-semibold text-text-main">{{ name }}</span>
          <span class="shrink-0 text-xs text-text-sub">v{{ version }}</span>
        </div>
        <div class="truncate text-sm text-text-sub">{{ author || '—' }}</div>
      </div>
      <Switch :model-value="enabled" @update:model-value="(v) => emit('toggle', v)" />
    </div>

    <p class="mt-2 line-clamp-2 min-h-10 text-sm text-text-sub">{{ description || '—' }}</p>

    <div v-if="commands?.length" class="mt-1 flex flex-wrap gap-1">
      <span
        v-for="c in commands"
        :key="c"
        class="rounded-full border border-glass-border px-2 py-0.5 text-xs text-text-sub"
      >
        /{{ c }}
      </span>
    </div>

    <div class="mt-3 flex items-center gap-2">
      <span
        class="flex items-center gap-1.5 rounded-full border border-glass-border px-2 py-0.5 text-xs"
        :title="lastError ?? statusLabel"
      >
        <span class="h-1.5 w-1.5 rounded-full" :style="{ background: statusColor }" />
        <span class="text-text-sub">{{ statusLabel }}</span>
      </span>
      <span v-if="lastError" class="truncate text-xs" style="color: var(--ds-danger)">
        {{ lastError }}
      </span>
      <span class="flex-1" />
      <button
        v-if="hasConfig"
        class="ds-icon-button"
        :title="t('settings.plugins.configure')"
        :aria-label="t('settings.plugins.configure')"
        @click="emit('configure')"
      >
        <Settings2 :size="15" :stroke-width="1.5" />
      </button>
      <button
        v-if="reloadable"
        class="ds-icon-button"
        :title="t('settings.plugins.reload')"
        :aria-label="t('settings.plugins.reload')"
        @click="emit('reload')"
      >
        <RotateCw :size="15" :stroke-width="1.5" />
      </button>
      <button
        class="ds-icon-button"
        :title="t('settings.plugins.uninstall')"
        :aria-label="t('settings.plugins.uninstall')"
        @click="emit('uninstall')"
      >
        <Trash2 :size="15" :stroke-width="1.5" />
      </button>
    </div>
  </div>
</template>
