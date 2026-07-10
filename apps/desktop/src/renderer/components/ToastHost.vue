<!-- apps/desktop/src/renderer/components/ToastHost.vue -->
<script setup lang="ts">
import { reactive } from 'vue';
import { ToastQueue } from './toast-queue';

const queue = reactive(new ToastQueue());
// 顶栏薄条 600ms / 浮卡 3s 自动消失（§2.6.3）。
function show(kind: 'bar' | 'float', text: string): void {
  const id = queue.push({ kind, text });
  setTimeout(() => queue.dismiss(id), kind === 'bar' ? 600 : 3000);
}
defineExpose({ show });
</script>
<template>
  <div
    v-for="t in queue.items.filter((x) => x.kind === 'bar')"
    :key="t.id"
    class="pointer-events-none fixed left-0 top-0 z-50 flex h-8 w-full items-center justify-center text-sm text-text-main"
    style="background: var(--ds-glass-bg)"
  >
    {{ t.text }}
  </div>
  <div class="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-2">
    <div
      v-for="t in queue.items.filter((x) => x.kind === 'float')"
      :key="t.id"
      class="rounded-card border border-glass-border bg-glass-bg px-4 py-3 text-base text-text-main backdrop-blur-glass"
    >
      {{ t.text }}
    </div>
  </div>
</template>
