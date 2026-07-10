<!-- settings/components/RowMenu.vue — 行内轻量菜单（历史页 ···/右键共用；无全局 ContextMenu 先例，自建薄组件）。 -->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

const props = defineProps<{ items: Array<{ key: string; label: string; danger?: boolean }> }>();
const emit = defineEmits<{ select: [key: string] }>();
const open = ref(false);
const root = ref<HTMLElement | null>(null);

function onDocClick(e: MouseEvent): void {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
onMounted(() => document.addEventListener('click', onDocClick));
onUnmounted(() => document.removeEventListener('click', onDocClick));

function pick(key: string): void {
  open.value = false;
  emit('select', key);
}
defineExpose({ openAt: (): void => void (open.value = true) });
</script>
<template>
  <div ref="root" class="relative">
    <button class="ds-icon-button" aria-label="menu" @click.stop="open = !open">···</button>
    <div
      v-if="open"
      class="ds-glass absolute right-0 top-8 z-20 min-w-[140px] rounded-panel border border-glass-border py-1 shadow-lg"
    >
      <button
        v-for="it in props.items"
        :key="it.key"
        class="block w-full px-3 py-1.5 text-left text-sm hover:bg-white/40"
        :style="it.danger ? 'color: var(--ds-danger)' : 'color: var(--ds-text-main)'"
        @click="pick(it.key)"
      >
        {{ it.label }}
      </button>
    </div>
  </div>
</template>
