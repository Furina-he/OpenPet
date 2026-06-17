<!-- apps/desktop/src/renderer/components/Slider.vue -->
<script setup lang="ts">
defineProps<{ modelValue: number; min?: number; max?: number; step?: number }>();
// update:modelValue 逐拖动（@input）即时预览；change 仅松手/键盘提交一次（用于持久化）。
const emit = defineEmits<{ 'update:modelValue': [number]; change: [number] }>();
</script>
<template>
  <input
    type="range"
    :min="min ?? 0"
    :max="max ?? 100"
    :step="step ?? 1"
    :value="modelValue"
    @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
    @change="emit('change', Number(($event.target as HTMLInputElement).value))"
  />
</template>
