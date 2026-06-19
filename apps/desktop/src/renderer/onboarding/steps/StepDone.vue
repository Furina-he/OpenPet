<!-- apps/desktop/src/renderer/onboarding/steps/StepDone.vue — 完成页（ui-design §7.4 终页） -->
<script setup lang="ts">
const emit = defineEmits<{ finish: [] }>();
// 快捷键提示文案对齐设计稿；Ctrl+Shift+D 呼叫 / 录制器为 M8（J2），本期仅文案。
const TIPS = ['Ctrl+Shift+D 随时呼叫我', '拖动我换个位置', '右键我可切换穿透 / 打开设置'];
</script>
<template>
  <div class="flex h-full flex-col">
    <div class="flex-1">
      <div class="text-lg text-text-main">✨ 准备好了！</div>
      <ul class="mt-4 space-y-2 text-base text-text-sub">
        <li v-for="t in TIPS" :key="t">· {{ t }}</li>
      </ul>
    </div>
    <div class="mt-6 flex justify-end">
      <button
        class="rounded-btn px-5 py-2 text-base text-white"
        style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
        @click="emit('finish')"
      >
        开始我们的故事 →
      </button>
    </div>
  </div>
</template>
