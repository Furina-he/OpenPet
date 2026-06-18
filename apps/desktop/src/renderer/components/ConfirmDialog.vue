<!-- apps/desktop/src/renderer/components/ConfirmDialog.vue — §2.8 ②级：整张红描边二次确认 -->
<script setup lang="ts">
defineProps<{ open: boolean; title: string; detail?: string; confirmLabel?: string }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>
<template>
  <div
    v-if="open"
    class="fixed inset-0 z-[60] flex items-center justify-center"
    style="background: rgba(0, 0, 0, 0.32)"
  >
    <div class="ds-glass w-[420px] rounded-panel border-2 p-5" style="border-color: var(--ds-danger)">
      <div class="text-md text-text-main">{{ title }}</div>
      <div v-if="detail" class="mt-2 text-sm text-text-sub">{{ detail }}</div>
      <div class="mt-5 flex justify-end gap-2">
        <button class="rounded-btn px-4 py-2 text-base text-text-sub" @click="emit('cancel')">
          取消
        </button>
        <button
          class="rounded-btn px-4 py-2 text-base text-white"
          style="background: var(--ds-danger)"
          @click="emit('confirm')"
        >
          {{ confirmLabel ?? '确认开启' }}
        </button>
      </div>
    </div>
  </div>
</template>
