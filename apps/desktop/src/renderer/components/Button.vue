<!-- apps/desktop/src/renderer/components/Button.vue -->
<script setup lang="ts">
defineProps<{ variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; disabled?: boolean }>();
</script>
<template>
  <button
    :disabled="disabled"
    class="rounded-btn px-4 py-2 text-base transition ease-ds active:scale-[0.97] disabled:opacity-50"
    :class="{
      'text-white': variant === 'primary' || variant === 'danger',
      'border border-glass-border bg-glass-bg text-text-main': variant === 'secondary' || !variant,
      'bg-transparent text-text-main': variant === 'ghost',
    }"
    :style="
      variant === 'primary'
        ? 'background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))'
        : variant === 'danger'
          ? 'background: var(--ds-danger)'
          : ''
    "
  >
    <slot />
  </button>
</template>
