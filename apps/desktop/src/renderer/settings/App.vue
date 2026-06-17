<!-- apps/desktop/src/renderer/settings/App.vue -->
<script setup lang="ts">
import { ref } from 'vue';
import { NAV_TREE, isActive } from './nav-tree';
import DisplayPage from './pages/DisplayPage.vue';
import ToastHost from '../components/ToastHost.vue';

const active = ref('system.display');
const toast = ref<InstanceType<typeof ToastHost> | null>(null);
function saved(): void {
  toast.value?.show('bar', '✓ 已保存');
}
</script>
<template>
  <div class="flex h-screen text-base" style="background: var(--ds-glass-bg)">
    <ToastHost ref="toast" />
    <!-- 左导航 280px -->
    <nav class="w-[280px] shrink-0 overflow-y-auto border-r border-glass-border p-3">
      <template v-for="g in NAV_TREE" :key="g.id">
        <div class="px-2 py-1 text-sm text-text-sub">{{ g.label }}</div>
        <button
          v-for="c in g.children"
          :key="c.id"
          class="block w-full rounded-btn px-3 py-2 text-left text-base"
          :class="isActive(c.id, active) ? 'text-text-main' : 'text-text-sub'"
          :style="isActive(c.id, active) ? 'background: var(--ds-glass-border)' : ''"
          @click="active = c.id"
        >
          {{ c.label }}
        </button>
      </template>
    </nav>
    <!-- 顶栏 56px + 内容区 + 状态条 32px -->
    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-[56px] items-center border-b border-glass-border px-4 text-text-main">
        DeskSoul · 设置
      </header>
      <main class="flex-1 overflow-y-auto p-6">
        <DisplayPage v-if="active === 'system.display'" @saved="saved" />
        <div v-else class="text-text-sub">（{{ active }} 留待 M7b）</div>
      </main>
      <footer class="flex h-8 items-center border-t border-glass-border px-4 text-sm text-text-sub">
        ● 就绪
      </footer>
    </div>
  </div>
</template>
