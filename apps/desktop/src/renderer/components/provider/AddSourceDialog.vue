<!-- components/provider/AddSourceDialog.vue — Provider 工作台「新增提供商源」
     **严格照 AstrBot AddNewProvider 交互**：当前能力下的具名 provider 卡片网格（图标 + 名 + Base），
     点卡片 → 用 generateUniqueSourceId 合成 ProviderSource（带 name/icon）→ emit create。
     图标走 providerIconUrl（lobehub CDN），加载失败回退首字母圆标（AstrBot 同款 fallback）。 -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, ref } from 'vue';
import {
  generateUniqueSourceId,
  providerIconUrl,
  type Capability,
  type ProviderSource,
  type ProviderTemplate,
} from '@openpet/protocol';

const { t } = useI18n();
const props = defineProps<{
  templates: ProviderTemplate[];
  existingIds: string[];
  capability: Capability;
}>();
const emit = defineEmits<{ create: [source: ProviderSource]; close: [] }>();

const choices = computed(() => props.templates.filter((t) => t.capability === props.capability));

// 图标加载失败的厂商键集合 → 回退首字母圆标。
const failed = ref<Set<string>>(new Set());
function onImgError(provider: string): void {
  failed.value = new Set(failed.value).add(provider);
}
function iconOf(t: ProviderTemplate): string {
  return failed.value.has(t.provider) ? '' : providerIconUrl(t.provider);
}

function pick(t: ProviderTemplate): void {
  const id = generateUniqueSourceId(t.id, props.existingIds);
  emit('create', {
    id,
    adapter: t.adapter,
    capability: props.capability,
    apiBase: t.apiBase,
    key: '',
    enabled: true,
    name: t.name,
    icon: t.provider,
  });
  emit('close');
}
</script>

<template>
  <div
    class="fixed inset-0 z-[60] flex items-center justify-center"
    style="background: rgba(0, 0, 0, 0.32)"
    @click.self="emit('close')"
  >
    <div class="ds-glass max-h-[88vh] w-[760px] overflow-y-auto rounded-panel p-5">
      <div class="text-md font-semibold text-text-main">{{ t('settings.providerUi.addSourceTitle') }}</div>
      <div class="mt-1 text-sm text-text-sub">{{ t('settings.providerUi.addSourceDesc') }}</div>

      <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <button
          v-for="tpl in choices"
          :key="tpl.id"
          class="ds-glass relative flex items-center gap-3 overflow-hidden rounded-card border border-glass-border p-3 text-left transition hover:border-brand-to"
          @click="pick(tpl)"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate font-semibold text-text-main">{{ tpl.name }}</span>
            <span class="block truncate text-sm text-text-sub">{{
              tpl.apiBase || t('settings.providerUi.localSelfHosted')
            }}</span>
          </span>
          <span class="grid h-10 w-10 shrink-0 place-items-center">
            <img
              v-if="iconOf(tpl)"
              :src="iconOf(tpl)"
              class="h-7 w-7 object-contain opacity-80"
              alt=""
              @error="onImgError(tpl.provider)"
            />
            <span
              v-else
              class="grid h-9 w-9 place-items-center rounded-full text-base font-bold text-white opacity-70"
              style="background: linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to))"
            >
              {{ tpl.name[0]?.toUpperCase() }}
            </span>
          </span>
        </button>
        <div
          v-if="!choices.length"
          class="col-span-full rounded-card border border-glass-border p-4 text-center text-sm text-text-sub"
        >
          {{ t('settings.providerUi.noTemplates') }}
        </div>
      </div>

      <div class="mt-5 flex justify-end">
        <button class="rounded-btn px-4 py-2 text-base text-text-sub" @click="emit('close')">
          {{ t('common.cancel') }}
        </button>
      </div>
    </div>
  </div>
</template>
