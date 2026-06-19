<!-- apps/desktop/src/renderer/onboarding/steps/Step2Model.vue — C2 占位（P3 填充） -->
<script setup lang="ts">
const emit = defineEmits<{ next: []; skip: [] }>();
</script>
<template>
  <div class="text-text-sub">
    C2 LLM 配置（P3 填充）
    <div class="mt-4 flex gap-2">
      <button class="rounded-btn px-4 py-2 text-base text-text-sub" @click="emit('skip')">
        暂时跳过 · 先和角色玩一下
      </button>
      <button
        class="rounded-btn px-4 py-2 text-base text-white"
        style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
        @click="emit('next')"
      >
        下一步 →
      </button>
    </div>
  </div>
</template>
