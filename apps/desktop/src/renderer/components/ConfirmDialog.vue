<!-- apps/desktop/src/renderer/components/ConfirmDialog.vue — §2.8 ②级：整张红描边二次确认 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
const props = defineProps<{ open: boolean; title: string; detail?: string; confirmLabel?: string }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const { t } = useI18n();
const confirmText = computed(() => props.confirmLabel ?? t('common.confirmEnable'));
const cancelBtn = ref<HTMLButtonElement | null>(null);
watch(
  () => props.open,
  (v) => {
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
      <div class="mt-5 flex justify-end gap-2">
        <button
          ref="cancelBtn"
          class="ds-focus rounded-btn px-4 py-2 text-base text-text-sub"
          @click="emit('cancel')"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          class="ds-focus rounded-btn px-4 py-2 text-base text-white"
          style="background: var(--ds-danger)"
          @click="emit('confirm')"
        >
          {{ confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>
