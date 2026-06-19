<!-- apps/desktop/src/renderer/onboarding/steps/Step4FirstChat.vue — C4 首句（ui-design §7.4；视觉 98171885 C4 区） -->
<script setup lang="ts">
import { ref } from 'vue';
import { STARTER_CHIPS } from '../chips';

const emit = defineEmits<{ next: [] }>();
const sending = ref(false);

async function pick(chip: string): Promise<void> {
  if (sending.value) return;
  sending.value = true;
  try {
    // 复用现有 overlay 会话；回复在完成页 finishOnboarding 显示 overlay 后可见。
    await window.desksoul.rpc('chat.send', { sessionId: 'default', text: chip });
    emit('next');
  } catch {
    sending.value = false; // 发送失败（如忙）→ 允许重试
  }
}
</script>
<template>
  <div class="flex h-full flex-col">
    <div class="flex-1">
      <div class="text-md text-text-main">和 TA 说第一句话</div>
      <p class="mt-2 text-base text-text-sub">点一句开始（也可之后在聊天框自由输入）：</p>
      <div class="mt-4 flex flex-wrap gap-2">
        <button
          v-for="c in STARTER_CHIPS"
          :key="c"
          class="rounded-btn border border-glass-border px-4 py-2 text-base text-text-main disabled:opacity-50"
          :disabled="sending"
          @click="pick(c)"
        >
          {{ c }}
        </button>
      </div>
    </div>
  </div>
</template>
