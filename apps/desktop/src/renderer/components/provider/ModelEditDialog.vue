<!-- components/provider/ModelEditDialog.vue — 模型条目配置弹窗（照 AstrBot 「编辑/新增 <id>」提供商弹窗，
     id/model 只读；可编辑 = 启用 · 模型能力（图像/音频/工具/推理）· 上下文窗口 tokens）。 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ModelEntry, ModelCaps } from '@openpet/protocol';
import Input from '../Input.vue';
import Switch from '../Switch.vue';
import Button from '../Button.vue';

const { t } = useI18n();
const props = defineProps<{
  open: boolean;
  entry: ModelEntry | null;
  mode: 'add' | 'edit';
  saving?: boolean;
}>();
const emit = defineEmits<{ save: [entry: ModelEntry]; cancel: [] }>();

const enabled = ref(true);
const caps = ref<ModelCaps>({});
const ctx = ref('');
watch(
  () => [props.open, props.entry?.id] as const,
  () => {
    if (!props.open || !props.entry) return;
    enabled.value = props.entry.enabled;
    caps.value = { ...props.entry.caps };
    ctx.value = props.entry.contextTokens ? String(props.entry.contextTokens) : '';
  },
  { immediate: true },
);
const title = computed(
  () =>
    `${props.mode === 'add' ? t('settings.providerUi.actionAdd') : t('common.edit')} ${props.entry?.id ?? ''}`,
);
const CAPS: Array<{ key: keyof ModelCaps; label: string }> = [
  { key: 'vision', label: 'settings.providerUi.capImage' },
  { key: 'audio', label: 'settings.providerUi.capAudio' },
  { key: 'tool', label: 'settings.providerUi.capTool' },
  { key: 'reasoning', label: 'settings.providerUi.capReasoning' },
];
function save(): void {
  if (!props.entry) return;
  const n = Number(ctx.value);
  emit('save', {
    ...props.entry,
    enabled: enabled.value,
    caps: { ...caps.value },
    ...(Number.isFinite(n) && n > 0 ? { contextTokens: Math.round(n) } : {}),
  });
}
</script>

<template>
  <div
    v-if="open && entry"
    class="fixed inset-0 z-[60] flex items-center justify-center"
    style="background: rgba(0, 0, 0, 0.32)"
    role="dialog"
    aria-modal="true"
    @click.self="emit('cancel')"
    @keydown.esc="emit('cancel')"
  >
    <div class="ds-glass w-[640px] max-w-[92vw] rounded-panel p-6">
      <h2 class="text-md font-semibold text-text-main">{{ title }}</h2>
      <div class="mt-4 divide-y divide-glass-border">
        <div class="grid grid-cols-[180px_1fr] items-center gap-4 py-3">
          <div class="font-semibold text-text-main">{{ t('settings.providerUi.tipModelId') }}</div>
          <div class="truncate font-mono text-sm text-text-sub">{{ entry.model }}</div>
        </div>
        <div class="grid grid-cols-[180px_1fr] items-center gap-4 py-3">
          <div class="font-semibold text-text-main">{{ t('common.enabledShort') }}</div>
          <div><Switch :model-value="enabled" @update:model-value="(v) => (enabled = v)" /></div>
        </div>
        <div class="grid grid-cols-[180px_1fr] items-start gap-4 py-3">
          <div>
            <div class="font-semibold text-text-main">
              {{ t('settings.providerUi.modalities') }}
            </div>
            <div class="mt-1 text-sm text-text-sub">
              {{ t('settings.providerUi.modalitiesDesc') }}
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <label
              v-for="c in CAPS"
              :key="c.key"
              class="flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition"
              :class="
                caps[c.key] ? 'border-brand-to text-text-main' : 'border-glass-border text-text-sub'
              "
            >
              <input
                type="checkbox"
                class="accent-[var(--ds-brand-to)]"
                :checked="Boolean(caps[c.key])"
                @change="caps = { ...caps, [c.key]: ($event.target as HTMLInputElement).checked }"
              />
              {{ t(c.label) }}
            </label>
          </div>
        </div>
        <div class="grid grid-cols-[180px_1fr] items-start gap-4 py-3">
          <div>
            <div class="font-semibold text-text-main">
              {{ t('settings.providerUi.contextTokens') }}
            </div>
            <div class="mt-1 text-sm text-text-sub">
              {{ t('settings.providerUi.contextTokensDesc') }}
            </div>
          </div>
          <Input v-model="ctx" type="number" class="w-full" placeholder="128000" />
        </div>
      </div>
      <div class="mt-5 flex justify-end gap-2">
        <Button variant="ghost" :disabled="saving" @click="emit('cancel')">{{
          t('common.cancel')
        }}</Button>
        <Button variant="primary" :disabled="saving" @click="save">{{ t('common.save') }}</Button>
      </div>
    </div>
  </div>
</template>
