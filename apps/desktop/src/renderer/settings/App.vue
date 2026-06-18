<!-- apps/desktop/src/renderer/settings/App.vue -->
<script setup lang="ts">
import { ref } from 'vue';
import { NAV_TREE, isActive } from './nav-tree';
import GeneralPage from './pages/GeneralPage.vue';
import DisplayPage from './pages/DisplayPage.vue';
import PrivacyPage from './pages/PrivacyPage.vue';
import ModelApiPage from './pages/ModelApiPage.vue';
import AboutPage from './pages/AboutPage.vue';
import ToastHost from '../components/ToastHost.vue';
import { initialRoute } from '../dev/route';

const active = ref(initialRoute(window.location.search, 'system.display'));
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
        <button
          v-if="g.children.length === 0"
          class="flex w-full items-center gap-2 rounded-btn px-2 py-2 text-left text-base"
          :class="isActive(g.id, active) ? 'text-text-main' : 'text-text-sub'"
          :style="isActive(g.id, active) ? 'background: var(--ds-glass-border)' : ''"
          @click="active = g.id"
        >
          <component :is="g.icon" :size="16" :stroke-width="1.5" />
          <span>{{ g.label }}</span>
        </button>
        <div v-else class="flex items-center gap-2 px-2 py-1 text-sm text-text-sub">
          <component :is="g.icon" :size="16" :stroke-width="1.5" />
          <span>{{ g.label }}</span>
        </div>
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
        <GeneralPage v-if="active === 'system.general'" @saved="saved" />
        <DisplayPage v-else-if="active === 'system.display'" @saved="saved" />
        <PrivacyPage v-else-if="active === 'system.privacy'" @saved="saved" />
        <ModelApiPage v-else-if="active === 'model'" @saved="saved" />
        <AboutPage v-else-if="active === 'system.about'" />
        <div v-else class="text-text-sub">（{{ active }} 留待 M7b）</div>
      </main>
      <footer class="flex h-8 items-center border-t border-glass-border px-4 text-sm text-text-sub">
        ● 就绪
      </footer>
    </div>
  </div>
</template>
