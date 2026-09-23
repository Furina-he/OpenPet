<!-- components/provider/ManualModelDialog.vue — 「添加自定义模型」（照 AstrBot showManualModelDialog）：
     模型 ID 输入 + 只读预览「源ID/模型ID」；确认 → 父打开模型配置弹窗（mode add）。 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Input from '../Input.vue';
import Button from '../Button.vue';
import { manualModelPreview } from '../../settings/provider-workbench';

const { t } = useI18n();
const props = defineProps<{ open: boolean; sourceId: string; existing: string[] }>();
const emit = defineEmits<{ confirm: [modelId: string]; cancel: [] }>();
const modelId = ref('');
const error = ref('');
watch(
  () => props.open,
  (v) => {
    if (v) {
      modelId.value = '';
      error.value = '';
    }
  },
);
const preview = computed(() => manualModelPreview(props.sourceId, modelId.value));
function confirm(): void {
  const m = modelId.value.trim();
  if (!m) {
    error.value = t('settings.providerUi.manualModelRequired');
    return;
  }
  if (props.existing.includes(m)) {
    error.value = t('settings.providerUi.manualModelExists');
    return;
  }
  emit('confirm', m);
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-[60] flex items-center justify-center"
    style="background: rgba(0, 0, 0, 0.32)"
    role="dialog"
    aria-modal="true"
    @click.self="emit('cancel')"
    @keydown.esc="emit('cancel')"
  >
    <div class="ds-glass w-[400px] max-w-[92vw] rounded-panel p-6">
      <h2 class="text-md font-semibold text-text-main">
        {{ t('settings.providerUi.manualDialogTitle') }}
      </h2>
      <div class="mt-4 space-y-3">
        <label class="block">
          <span class="text-sm text-text-sub">{{
            t('settings.providerUi.manualDialogModelLabel')
          }}</span>
          <Input v-model="modelId" class="mt-1 w-full" autofocus @keyup.enter="confirm" />
        </label>
        <label class="block">
          <span class="text-sm text-text-sub">{{
            t('settings.providerUi.manualDialogPreviewLabel')
          }}</span>
          <Input
            :model-value="preview"
            class="mt-1 w-full opacity-70"
            readonly
            @update:model-value="() => {}"
          />
          <span class="mt-1 block text-xs text-text-sub">{{
            t('settings.providerUi.manualDialogPreviewHint')
          }}</span>
        </label>
        <p v-if="error" class="text-sm" style="color: var(--ds-danger)">{{ error }}</p>
      </div>
      <div class="mt-5 flex justify-end gap-2">
        <Button variant="ghost" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
        <Button variant="primary" @click="confirm">{{ t('common.add') }}</Button>
      </div>
    </div>
  </div>
</template>
