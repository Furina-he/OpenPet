<!-- apps/desktop/src/renderer/components/Button.vue -->
<script setup lang="ts">
defineProps<{ variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; disabled?: boolean }>();
</script>
<template>
  <button
    :disabled="disabled"
    class="ds-control rounded-btn px-4 py-2 text-base transition ease-ds active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
    :class="{
      'text-white': variant === 'primary' || variant === 'danger',
      'text-text-main': variant === 'secondary' || !variant,
      'border-transparent bg-transparent text-text-main shadow-none': variant === 'ghost',
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
