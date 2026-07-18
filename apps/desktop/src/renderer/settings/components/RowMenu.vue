<!-- settings/components/RowMenu.vue — 行内轻量菜单（历史页 ···/右键共用；无全局 ContextMenu 先例，自建薄组件）。
     菜单 Teleport 到 body + fixed 定位：行容器 ds-glass(backdrop-filter)/hover transform 各自
     创建层叠上下文，行内 absolute 菜单会被后续兄弟行盖住（真窗 bug 2026-07-18）。 -->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

const props = defineProps<{ items: Array<{ key: string; label: string; danger?: boolean }> }>();
const emit = defineEmits<{ select: [key: string] }>();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const pos = ref({ top: 0, right: 0 });

function toggle(): void {
  if (!open.value && root.value) {
    const r = root.value.getBoundingClientRect();
    pos.value = { top: r.bottom + 4, right: window.innerWidth - r.right };
  }
  open.value = !open.value;
}

function onDocClick(e: MouseEvent): void {
  const t = e.target as Node;
  if (root.value?.contains(t) || menu.value?.contains(t)) return;
  open.value = false;
}
function onScrollOrResize(): void {
  open.value = false; // fixed 定位不随内容滚动，滚动/缩放时直接收起
}
onMounted(() => {
  document.addEventListener('click', onDocClick);
  window.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize);
});
onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
  window.removeEventListener('scroll', onScrollOrResize, true);
  window.removeEventListener('resize', onScrollOrResize);
});

function pick(key: string): void {
  open.value = false;
  emit('select', key);
}
defineExpose({ openAt: (): void => toggle() });
</script>
<template>
  <div ref="root" class="relative">
    <button class="ds-icon-button" aria-label="menu" @click.stop="toggle">···</button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="menu"
        class="ds-glass fixed z-50 min-w-[140px] rounded-panel border border-glass-border py-1 shadow-lg"
        :style="{ top: `${pos.top}px`, right: `${pos.right}px` }"
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
    </Teleport>
  </div>
</template>
