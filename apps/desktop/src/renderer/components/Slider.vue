<!-- apps/desktop/src/renderer/components/Slider.vue -->
<script setup lang="ts">
defineProps<{ modelValue: number; min?: number; max?: number; step?: number }>();
const emit = defineEmits<{ 'update:modelValue': [number] }>();
</script>
<template>
  <input
    type="range"
    :min="min ?? 0"
    :max="max ?? 100"
    :step="step ?? 1"
    :value="modelValue"
    @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
  />
</template>
