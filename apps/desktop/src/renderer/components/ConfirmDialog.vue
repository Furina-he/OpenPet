<!-- apps/desktop/src/renderer/components/ConfirmDialog.vue — §2.8 ②级：整张红描边二次确认；
     传 typedWord（如 'DELETE'）升级为 ③级：需逐字输入才能确认。 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
const props = defineProps<{
  open: boolean;
  title: string;
  detail?: string;
  confirmLabel?: string;
  /** ③级确认：用户须输入该词（大小写敏感）确认按钮才可用。 */
  typedWord?: string;
}>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const { t } = useI18n();
const confirmText = computed(() => props.confirmLabel ?? t('common.confirmEnable'));
const cancelBtn = ref<HTMLButtonElement | null>(null);
const typed = ref('');
const canConfirm = computed(() => !props.typedWord || typed.value === props.typedWord);
watch(
  () => props.open,
  (v) => {
    typed.value = '';
    if (v) requestAnimationFrame(() => cancelBtn.value?.focus()); // 危险确认：默认焦点落安全侧
  },
);
</script>
<template>
  <div
    v-if="open"
    role="dialog"
    aria-modal="true"
    :aria-label="title"
    class="fixed inset-0 z-[60] flex items-center justify-center"
    style="background: rgba(0, 0, 0, 0.32)"
    @keydown.esc.stop="emit('cancel')"
  >
    <div
      class="ds-glass w-[420px] rounded-panel border-2 p-5"
      style="border-color: var(--ds-danger)"
    >
      <div class="text-md text-text-main">{{ title }}</div>
      <div v-if="detail" class="mt-2 text-sm text-text-sub">{{ detail }}</div>
      <label v-if="typedWord" class="mt-3 block text-sm text-text-sub">
        {{ t('common.typeToConfirm', { word: typedWord }) }}
        <input
          v-model="typed"
          class="ds-control mt-1 w-full rounded-input px-3 py-2 font-mono text-base text-text-main"
          :placeholder="typedWord"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <div class="mt-5 flex justify-end gap-2">
        <button
          ref="cancelBtn"
          class="ds-focus rounded-btn px-4 py-2 text-base text-text-sub"
          @click="emit('cancel')"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          class="ds-focus rounded-btn px-4 py-2 text-base text-white disabled:opacity-40"
          style="background: var(--ds-danger)"
          :disabled="!canConfirm"
          @click="canConfirm && emit('confirm')"
        >
          {{ confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>
