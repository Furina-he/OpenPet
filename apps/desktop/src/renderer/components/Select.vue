<!-- apps/desktop/src/renderer/components/Select.vue -->
<script setup lang="ts">
defineProps<{ modelValue: string; options: ReadonlyArray<{ value: string; label: string }> }>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();
</script>
<template>
  <div class="relative inline-block min-w-[160px]">
    <select
      class="ds-control w-full appearance-none rounded-input py-2 pl-3 pr-9 text-base text-text-main"
      :value="modelValue"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <span
      class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-sub"
      >▾</span
    >
  </div>
</template>
