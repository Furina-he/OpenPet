<!-- apps/desktop/src/renderer/components/KeyCap.vue — J2 录制：点击进入监听，按下组合即捕获 -->
<script setup lang="ts">
import { ref } from 'vue';
import { toAccelerator } from '../settings/keycap-accel';
import { validateAccelerator } from '@desksoul/protocol';

defineProps<{ value: string }>();
const emit = defineEmits<{ capture: [accelerator: string] }>();
const listening = ref(false);

function onKeydown(e: KeyboardEvent): void {
  if (!listening.value) return;
  e.preventDefault();
  const acc = toAccelerator(e);
  if (!acc) return; // 纯修饰，等普通键
  if (validateAccelerator(acc).ok) {
    listening.value = false;
    emit('capture', acc);
  }
}
</script>
<template>
  <button
    class="rounded-input border px-3 py-1.5 text-sm"
    :class="
      listening
        ? 'animate-pulse border-brand-to text-text-main'
        : 'border-glass-border text-text-sub'
    "
    tabindex="0"
    @click="listening = true"
    @blur="listening = false"
    @keydown="onKeydown"
  >
    {{ listening ? '按下组合键…' : value || '未设置' }}
  </button>
</template>
