<!-- apps/desktop/src/renderer/overlay/components/Bubble.vue — B2 单条气泡（P2 基础；思考/折叠/错误态 P3 加）
     视觉 UI/60ea4a18（B2 区）。 -->
<script setup lang="ts">
import type { ChatMessage } from '../chat-view';

defineProps<{ message: ChatMessage; streaming: boolean }>();
</script>
<template>
  <div
    class="max-w-[86%] whitespace-pre-wrap break-words rounded-card px-3.5 py-2.5 text-base leading-relaxed"
    :class="message.role === 'user' ? 'self-end text-white' : 'ds-glass self-start text-text-main'"
    :style="
      message.role === 'user'
        ? 'background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))'
        : ''
    "
  >
    <span>{{ message.text }}</span>
    <span
      v-if="message.role === 'assistant' && message.finishReason === null && streaming"
      class="ml-0.5 inline-block h-[1.1em] w-[7px] translate-y-[2px] animate-pulse"
      style="background: var(--ds-brand-to)"
    />
    <span
      v-if="message.finishReason === 'cancel'"
      class="ml-2 rounded-full bg-glass-border px-2 py-0.5 text-sm text-text-sub"
    >
      已取消
    </span>
    <span
      v-else-if="message.finishReason === 'error'"
      class="ml-2 rounded-full px-2 py-0.5 text-sm text-white"
      style="background: var(--ds-danger)"
    >
      出错了
    </span>
  </div>
</template>
