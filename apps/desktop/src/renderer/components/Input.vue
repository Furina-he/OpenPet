<!-- apps/desktop/src/renderer/components/Input.vue -->
<script setup lang="ts">
defineProps<{ modelValue: string; placeholder?: string }>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();
</script>
<template>
  <input
    class="ds-control rounded-input px-3 py-2 text-base text-text-main"
    :value="modelValue"
    :placeholder="placeholder"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
