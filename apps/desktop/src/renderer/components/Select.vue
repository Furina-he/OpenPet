<!-- apps/desktop/src/renderer/components/Select.vue -->
<script setup lang="ts">
defineProps<{ modelValue: string; options: ReadonlyArray<{ value: string; label: string }> }>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();
</script>
<template>
  <select
    class="rounded-input border border-glass-border bg-glass-bg px-3 py-2 text-base text-text-main"
    :value="modelValue"
    @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
  </select>
</template>
