<!-- apps/desktop/src/renderer/onboarding/steps/Step3Character.vue — C3 占位（P4 填充） -->
<script setup lang="ts">
const emit = defineEmits<{ next: [] }>();
</script>
<template>
  <div class="text-text-sub">
    C3 角色选择（P4 填充）
    <div class="mt-4">
      <button
        class="rounded-btn px-4 py-2 text-base text-white"
        style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
        @click="emit('next')"
      >
        就用 TA →
      </button>
    </div>
  </div>
</template>
