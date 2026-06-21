<!-- apps/desktop/src/renderer/components/Switch.vue -->
<script setup lang="ts">
defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [boolean] }>();
</script>
<template>
  <button
    role="switch"
    :aria-checked="modelValue"
    class="relative h-7 w-12 rounded-full transition ease-ds focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-to/40"
    :style="
      modelValue
        ? 'background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))'
        : 'background: rgba(23,24,33,0.12)'
    "
    @click="emit('update:modelValue', !modelValue)"
  >
    <span
      class="absolute top-0.5 h-6 w-6 rounded-full bg-white transition ease-ds"
      :style="
        modelValue
          ? 'left: 22px; box-shadow: 0 4px 12px rgba(255,143,171,0.35)'
          : 'left: 2px; box-shadow: 0 3px 10px rgba(0,0,0,0.16)'
      "
    />
  </button>
</template>
