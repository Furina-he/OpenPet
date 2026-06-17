<!-- apps/desktop/src/renderer/components/Switch.vue -->
<script setup lang="ts">
defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [boolean] }>();
</script>
<template>
  <button
    role="switch"
    :aria-checked="modelValue"
    class="relative h-6 w-11 rounded-full transition ease-ds"
    :style="modelValue ? 'background: var(--ds-brand-to)' : 'background: var(--ds-glass-border)'"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span
      class="absolute top-0.5 h-5 w-5 rounded-full bg-white transition ease-ds"
      :style="modelValue ? 'left: 22px' : 'left: 2px'"
    />
  </button>
</template>
