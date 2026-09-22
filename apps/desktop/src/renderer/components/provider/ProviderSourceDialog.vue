<!-- components/provider/ProviderSourceDialog.vue — 「新建模型供应商」弹窗（照 AstrBot ProviderSourceDialog）：
     标题 + 搜索框 + 关闭；「提供商」分组（计数）三列卡片（图标 + 名 + 域名副标）；无结果提示。
     点卡片 → emit select(template)（父侧生成本地草稿，保存前不落盘，同 AstrBot addProviderSource）。 -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Search, X } from 'lucide-vue-next';
import { providerIconUrl, type Capability, type ProviderTemplate } from '@openpet/protocol';
import { templateCards } from '../../settings/provider-workbench';

const { t } = useI18n();
const props = defineProps<{ templates: ProviderTemplate[]; capability: Capability }>();
const emit = defineEmits<{ select: [template: ProviderTemplate]; close: [] }>();

const query = ref('');
const cards = computed(() => templateCards(props.templates, props.capability, query.value));
const failed = ref<Set<string>>(new Set());
const iconOf = (p: string): string => (failed.value.has(p) ? '' : providerIconUrl(p));
function onImgError(p: string): void {
  failed.value = new Set(failed.value).add(p);
}
</script>

<template>
  <div
    class="fixed inset-0 z-[60] flex items-center justify-center"
    style="background: rgba(0, 0, 0, 0.32)"
    role="dialog"
    aria-modal="true"
    :aria-label="t('settings.providerUi.dialogTitle')"
    @click.self="emit('close')"
    @keydown.esc="emit('close')"
  >
    <div class="ds-glass flex max-h-[88vh] w-[820px] flex-col rounded-panel">
      <div
        class="grid grid-cols-[minmax(0,1fr)_minmax(200px,300px)_auto] items-center gap-4 px-6 pt-5"
      >
        <div class="text-md font-semibold text-text-main">
          {{ t('settings.providerUi.dialogTitle') }}
        </div>
        <label class="ds-control flex items-center gap-2 rounded-input px-3 py-1.5">
          <Search :size="15" :stroke-width="1.5" class="shrink-0 text-text-sub" />
          <input
            v-model="query"
            class="min-w-0 flex-1 bg-transparent text-base text-text-main outline-none"
            :placeholder="t('settings.providerUi.search')"
            :aria-label="t('settings.providerUi.search')"
            autofocus
          />
          <button
            v-if="query"
            class="text-text-sub hover:text-text-main"
            :aria-label="t('settings.providerUi.clearSearch')"
            @click="query = ''"
          >
            <X :size="14" :stroke-width="1.5" />
          </button>
        </label>
        <button
          class="ds-icon-button min-h-8 min-w-8"
          :aria-label="t('common.close')"
          @click="emit('close')"
        >
          <X :size="17" :stroke-width="1.5" />
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-5">
        <section v-if="cards.length" :aria-label="t('settings.providerUi.groupProviders')">
          <div class="mb-3 flex items-center justify-between px-1">
            <h3 class="text-sm font-semibold text-text-main">
              {{ t('settings.providerUi.groupProviders') }}
            </h3>
            <span class="text-xs tabular-nums text-text-sub">{{ cards.length }}</span>
          </div>
          <div class="grid grid-cols-2 gap-x-2.5 gap-y-1.5 sm:grid-cols-3">
            <button
              v-for="c in cards"
              :key="c.template.id"
              class="flex min-h-12 items-center gap-3 rounded-card border border-glass-border p-3 text-left transition hover:border-brand-to hover:bg-glass-border/40"
              :aria-label="c.label"
              @click="emit('select', c.template)"
            >
              <span class="grid h-6 w-6 shrink-0 place-items-center">
                <img
                  v-if="iconOf(c.template.provider)"
                  :src="iconOf(c.template.provider)"
                  class="h-6 w-6 object-contain"
                  alt=""
                  @error="onImgError(c.template.provider)"
                />
                <span
                  v-else
                  class="text-[22px] font-semibold leading-none text-text-main"
                  aria-hidden="true"
                >
                  {{ c.label.charAt(0) }}
                </span>
              </span>
              <span class="flex min-w-0 flex-col gap-1">
                <span class="truncate text-sm font-medium text-text-main">{{ c.label }}</span>
                <span class="truncate text-[11px] leading-4 text-text-sub">
                  {{ c.subtitle || t('settings.providerUi.localSelfHosted') }}
                </span>
              </span>
            </button>
          </div>
        </section>
        <div v-else class="grid place-items-center px-6 py-10 text-sm text-text-sub" role="status">
          {{ t('settings.providerUi.noResults') }}
        </div>
      </div>
    </div>
  </div>
</template>
