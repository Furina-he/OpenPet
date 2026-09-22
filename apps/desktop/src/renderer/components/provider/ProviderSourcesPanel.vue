<!-- components/provider/ProviderSourcesPanel.vue — 工作台左栏（照 AstrBot ProviderSourcesPanel）：
     头部标题 + 「+ 新增」；列表行 = 图标 + 名 + Base URL 副行，悬停/选中出删除；空态。
     列表含未保存草稿（父侧 draft 标记），选中态按 id。 -->
<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Plus, Trash2, Unplug } from 'lucide-vue-next';
import { providerIconUrl, type ProviderSource } from '@openpet/protocol';

const { t } = useI18n();
defineProps<{
  sources: ProviderSource[];
  activeId: string;
  title: string;
  emptyText: string;
  deleteLabel: string;
  canAdd: boolean;
}>();
const emit = defineEmits<{ add: []; select: [id: string]; remove: [source: ProviderSource] }>();

const failed = ref<Set<string>>(new Set());
const iconOf = (s: ProviderSource): string =>
  s.icon && !failed.value.has(s.icon) ? providerIconUrl(s.icon) : '';
function onImgError(icon?: string): void {
  if (icon) failed.value = new Set(failed.value).add(icon);
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex items-center justify-between gap-3 px-5 pb-3 pt-5">
      <h3 class="text-base font-semibold text-text-main">{{ title }}</h3>
      <button
        class="flex items-center gap-1 rounded-btn px-2.5 py-1 text-sm font-medium transition disabled:opacity-40"
        :style="{ color: 'var(--ds-brand-to)' }"
        :disabled="!canAdd"
        @click="emit('add')"
      >
        <Plus :size="15" :stroke-width="1.75" />
        {{ t('settings.providerUi.add') }}
      </button>
    </div>

    <div v-if="sources.length" class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4">
      <button
        v-for="s in sources"
        :key="s.id"
        class="group flex w-full items-center gap-2.5 rounded-card px-3 py-2.5 text-left transition"
        :class="s.id === activeId ? 'bg-glass-border' : 'hover:bg-glass-border/60'"
        @click="emit('select', s.id)"
      >
        <span class="grid h-7 w-7 shrink-0 place-items-center">
          <img
            v-if="iconOf(s)"
            :src="iconOf(s)"
            class="h-6 w-6 object-contain"
            alt=""
            @error="onImgError(s.icon)"
          />
          <span
            v-else
            class="grid h-6 w-6 place-items-center rounded-lg text-xs font-bold text-white"
            style="background: linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to))"
          >
            {{ (s.name || s.id).charAt(0).toUpperCase() }}
          </span>
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-semibold text-text-main">{{ s.id }}</span>
          <span class="mt-0.5 block truncate text-xs text-text-sub">{{
            s.apiBase || s.adapter
          }}</span>
        </span>
        <span
          class="shrink-0 rounded-btn p-1 text-text-sub opacity-0 transition hover:text-text-main group-hover:opacity-100"
          :class="s.id === activeId ? 'opacity-100' : ''"
          role="button"
          :title="deleteLabel"
          :aria-label="deleteLabel"
          @click.stop="emit('remove', s)"
        >
          <Trash2 :size="15" :stroke-width="1.5" />
        </span>
      </button>
    </div>
    <div v-else class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <Unplug :size="40" :stroke-width="1.25" class="text-text-sub opacity-60" />
      <p class="text-sm text-text-sub">{{ emptyText }}</p>
    </div>
  </div>
</template>
