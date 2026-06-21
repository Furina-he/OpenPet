<!-- apps/desktop/src/renderer/settings/App.vue -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  Activity,
  Bell,
  ChevronLeft,
  ChevronRight,
  Menu,
  Minus,
  Plus,
  Search,
  Settings,
  Sun,
  Wifi,
  X,
} from 'lucide-vue-next';
import { NAV_TREE, isActive } from './nav-tree';
import GeneralPage from './pages/GeneralPage.vue';
import DisplayPage from './pages/DisplayPage.vue';
import PrivacyPage from './pages/PrivacyPage.vue';
import ModelApiPage from './pages/ModelApiPage.vue';
import AboutPage from './pages/AboutPage.vue';
import HotkeysPage from './pages/HotkeysPage.vue';
import ToastHost from '../components/ToastHost.vue';
import { initialRoute } from '../dev/route';

const active = ref(initialRoute(window.location.search, 'system.display'));
const toast = ref<InstanceType<typeof ToastHost> | null>(null);
function saved(): void {
  toast.value?.show('bar', '✓ 已保存');
}

const activeMeta = computed(() => {
  for (const group of NAV_TREE) {
    if (group.id === active.value) return { group: group.label, leaf: group.label };
    const leaf = group.children.find((item) => item.id === active.value);
    if (leaf) return { group: group.label, leaf: leaf.label };
  }
  return { group: 'DeskSoul', leaf: active.value };
});
function groupActive(groupId: string): boolean {
  const group = NAV_TREE.find((item) => item.id === groupId);
  return Boolean(
    group && (group.id === active.value || group.children.some((item) => item.id === active.value)),
  );
}
</script>
<template>
  <div class="ds-window-bg flex h-screen p-4 text-base">
    <ToastHost ref="toast" />
    <section class="ds-glass flex h-full min-h-0 w-full overflow-hidden rounded-panel">
      <!-- 左导航 280px -->
      <nav class="flex w-[280px] shrink-0 flex-col border-r border-glass-border p-4">
        <div class="mb-5 flex items-center gap-3 px-1">
          <span class="ds-avatar h-8 w-8 text-sm">D</span>
          <div class="min-w-0">
            <div class="truncate text-md font-semibold text-text-main">DeskSoul P0</div>
            <div class="text-sm text-text-sub">桌面伙伴控制台</div>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto pr-1">
          <template v-for="g in NAV_TREE" :key="g.id">
            <button
              v-if="g.children.length === 0"
              class="relative mb-1 flex min-h-10 w-full items-center gap-3 rounded-btn px-3 text-left text-base transition ease-ds"
              :class="
                isActive(g.id, active) ? 'text-text-main' : 'text-text-sub hover:text-text-main'
              "
              :style="isActive(g.id, active) ? 'background: var(--ds-warm-soft)' : ''"
              @click="active = g.id"
            >
              <span
                v-if="isActive(g.id, active)"
                class="absolute left-0 h-5 w-1 rounded-full"
                style="
                  background: linear-gradient(180deg, var(--ds-brand-from), var(--ds-brand-to));
                "
              />
              <component :is="g.icon" :size="16" :stroke-width="1.5" />
              <span>{{ g.label }}</span>
            </button>
            <div
              v-else
              class="mt-3 flex items-center gap-3 px-3 py-1 text-sm"
              :class="groupActive(g.id) ? 'text-text-main' : 'text-text-sub'"
            >
              <component :is="g.icon" :size="16" :stroke-width="1.5" />
              <span>{{ g.label }}</span>
            </div>
            <button
              v-for="c in g.children"
              :key="c.id"
              class="relative mb-1 flex min-h-9 w-full items-center rounded-btn pl-10 pr-3 text-left text-base transition ease-ds"
              :class="
                isActive(c.id, active) ? 'text-text-main' : 'text-text-sub hover:text-text-main'
              "
              :style="isActive(c.id, active) ? 'background: var(--ds-warm-soft)' : ''"
              @click="active = c.id"
            >
              <span
                v-if="isActive(c.id, active)"
                class="absolute left-3 h-1.5 w-1.5 rounded-full"
                style="background: var(--ds-brand-to)"
              />
              {{ c.label }}
            </button>
          </template>
        </div>

        <div class="mt-4 rounded-panel border border-glass-border bg-white/30 p-3">
          <div class="flex items-center gap-3">
            <span class="ds-avatar h-11 w-11 text-base">小</span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-base font-medium text-text-main">小企鹅</div>
              <div class="flex items-center gap-1 text-sm text-text-sub">
                <span class="h-1.5 w-1.5 rounded-full" style="background: var(--ds-success)" />
                在线
              </div>
            </div>
            <button class="ds-icon-button" title="角色设置">
              <Settings :size="16" :stroke-width="1.5" />
            </button>
          </div>
        </div>
      </nav>

      <!-- 顶栏 56px + 内容区 + 状态条 32px -->
      <div class="flex min-w-0 flex-1 flex-col">
        <header
          class="flex h-[56px] shrink-0 items-center justify-between border-b border-glass-border px-4 text-text-main"
        >
          <div class="flex items-center gap-2">
            <button class="ds-icon-button" title="折叠导航">
              <Menu :size="17" :stroke-width="1.5" />
            </button>
            <button class="ds-icon-button" title="后退">
              <ChevronLeft :size="17" :stroke-width="1.5" />
            </button>
            <button class="ds-icon-button" title="前进">
              <ChevronRight :size="17" :stroke-width="1.5" />
            </button>
            <div class="relative ml-2 w-[320px]">
              <Search
                class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-sub"
                :size="15"
                :stroke-width="1.5"
              />
              <input
                class="ds-control h-9 w-full rounded-input py-1.5 pl-9 pr-20 text-sm text-text-main"
                placeholder="搜索对话、角色、知识库..."
              />
              <span
                class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-btn border border-glass-border px-2 py-0.5 text-xs text-text-sub"
              >
                Ctrl + K
              </span>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button class="ds-icon-button" title="新建">
              <Plus :size="17" :stroke-width="1.5" />
            </button>
            <span class="mx-1 h-5 w-px bg-glass-border" />
            <button class="ds-icon-button" title="主题">
              <Sun :size="17" :stroke-width="1.5" />
            </button>
            <button class="ds-icon-button" title="通知">
              <Bell :size="17" :stroke-width="1.5" />
            </button>
            <span class="ds-avatar h-8 w-8 text-sm">小</span>
            <span class="text-sm font-medium text-text-main">小企鹅</span>
            <button class="ds-icon-button" title="最小化">
              <Minus :size="16" :stroke-width="1.5" />
            </button>
            <button class="ds-icon-button" title="关闭">
              <X :size="16" :stroke-width="1.5" />
            </button>
          </div>
        </header>
        <main class="min-h-0 flex-1 overflow-y-auto p-6">
          <div class="mb-5 flex items-end justify-between gap-4">
            <div>
              <div class="text-sm text-text-sub">{{ activeMeta.group }}</div>
              <h1 class="mt-1 text-xl font-semibold leading-tight text-text-main">
                {{ activeMeta.leaf }}
              </h1>
            </div>
            <div
              class="rounded-full border border-glass-border bg-white/30 px-3 py-1 text-sm text-text-sub"
            >
              已同步偏好
            </div>
          </div>
          <GeneralPage v-if="active === 'system.general'" @saved="saved" />
          <DisplayPage v-else-if="active === 'system.display'" @saved="saved" />
          <PrivacyPage v-else-if="active === 'system.privacy'" @saved="saved" />
          <ModelApiPage v-else-if="active === 'model'" @saved="saved" />
          <HotkeysPage v-else-if="active === 'system.hotkeys'" @saved="saved" />
          <AboutPage v-else-if="active === 'system.about'" />
          <div v-else class="ds-glass rounded-panel p-6 text-text-sub">
            {{ activeMeta.leaf }} 会在后续里程碑接入。当前可以先从设置页体验视觉与交互框架。
          </div>
        </main>
        <footer
          class="flex h-8 shrink-0 items-center justify-between border-t border-glass-border px-4 text-sm text-text-sub"
        >
          <div class="flex items-center gap-4">
            <span class="flex items-center gap-1">
              <Activity :size="13" :stroke-width="1.5" />
              运行中
            </span>
            <span class="flex items-center gap-1">
              <Wifi :size="13" :stroke-width="1.5" />
              已连接
            </span>
          </div>
          <div class="flex items-center gap-4">
            <span>模型：GPT-4o</span>
            <span class="flex items-center gap-2">
              Token: 32.6K / 200K
              <span class="h-1 w-20 overflow-hidden rounded-full bg-glass-border">
                <span
                  class="block h-full w-[28%]"
                  style="
                    background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to));
                  "
                />
              </span>
            </span>
            <span>v0.1.0</span>
          </div>
        </footer>
      </div>
    </section>
  </div>
</template>
