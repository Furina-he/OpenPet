<!-- apps/desktop/src/renderer/settings/App.vue -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Activity,
  Bell,
  ChevronDown,
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
import { activeModelLabel, budgetVm } from './overview-view.js';
import OverviewPage from './pages/OverviewPage.vue';
import GeneralPage from './pages/GeneralPage.vue';
import DisplayPage from './pages/DisplayPage.vue';
import PrivacyPage from './pages/PrivacyPage.vue';
import ModelApiPage from './pages/ModelApiPage.vue';
import AboutPage from './pages/AboutPage.vue';
import HotkeysPage from './pages/HotkeysPage.vue';
import ChatPage from './pages/ChatPage.vue';
import HistoryPage from './pages/HistoryPage.vue';
import McpToolsPage from './pages/McpToolsPage.vue';
import ConnectionsPage from './pages/ConnectionsPage.vue';
import PluginsPage from './pages/PluginsPage.vue';
import KnowledgePage from './pages/KnowledgePage.vue';
import PersonaPage from './pages/PersonaPage.vue';
import MemoryPage from './pages/MemoryPage.vue';
import DataPage from './pages/DataPage.vue';
import VoicePage from './pages/VoicePage.vue';
import CharacterLibraryPage from './pages/CharacterLibraryPage.vue';
import CharacterEditorPage from './pages/CharacterEditorPage.vue';
import TracePage from './pages/TracePage.vue';
import ToastHost from '../components/ToastHost.vue';
import { initialRoute } from '../dev/route';

const { t } = useI18n();
const active = ref(initialRoute(window.location.search, 'overview'));
const toast = ref<InstanceType<typeof ToastHost> | null>(null);
function saved(): void {
  toast.value?.show('bar', t('settings.shell.savedToast'));
}

const activeMeta = computed(() => {
  for (const group of NAV_TREE) {
    if (group.id === active.value) return { group: t(group.label), leaf: t(group.label) };
    const leaf = group.children.find((item) => item.id === active.value);
    if (leaf) return { group: t(group.label), leaf: t(leaf.label) };
  }
  return { group: 'openpet', leaf: active.value };
});
function groupActive(groupId: string): boolean {
  const group = NAV_TREE.find((item) => item.id === groupId);
  return Boolean(
    group && (group.id === active.value || group.children.some((item) => item.id === active.value)),
  );
}

// AstrBot 式折叠组：默认收起；当前路由所在组自动展开（含 emit navigate 跳转）。
const openGroups = ref<Set<string>>(new Set());
// 会话管理：历史页点 IM 行 → 只读查看（不写指针；离开会话页即退出只读）。
const readonlySessionId = ref<string | null>(null);
function viewImSession(id: string): void {
  readonlySessionId.value = id;
  active.value = 'conversation.chat';
}
// ⑩.7 E4：库页「编辑」→ 编辑器带初始角色。
const editCharacterId = ref<string | null>(null);
function openEditor(id: string): void {
  editCharacterId.value = id;
  active.value = 'character.editor';
}
watch(active, (v) => {
  if (v !== 'conversation.chat') readonlySessionId.value = null;
});function toggleGroup(id: string): void {
  const next = new Set(openGroups.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  openGroups.value = next;
}
watch(
  active,
  (route) => {
    const g = NAV_TREE.find((x) => x.children.some((c) => c.id === route));
    if (g && !openGroups.value.has(g.id)) {
      openGroups.value = new Set([...openGroups.value, g.id]);
    }
  },
  { immediate: true },
);

// §7：诊断叶子仅开发者模式可见（D2 general.developerMode，实时生效）。
const devMode = ref(false);
// footer 真值（偿债：原硬编码 GPT-4o/32.6K/v0.1.0）——active 模型 + 本月用量 + 版本。
const footerModel = ref<string | null>(null);
const footerToken = ref<{ text: string; pct: number | null }>({ text: '0', pct: null });
const appVersion = ref('');
async function refreshFooter(): Promise<void> {
  const [p, u, v] = await Promise.all([
    window.openpet.rpc('app.prefs.getAll', {}),
    window.openpet.rpc('app.usageSummary', {}),
    window.openpet.rpc('app.version', {}),
  ]);
  footerModel.value = activeModelLabel(p['model.models'], p['model.defaultChatModelId']);
  footerToken.value = budgetVm(u.tokensIn + u.tokensOut, p['budget.enabled'], p['budget.monthlyCap']);
  appVersion.value = v.version;
}
onMounted(async () => {
  void refreshFooter();
  setInterval(() => void refreshFooter(), 60_000);
  const p = await window.openpet.rpc('app.prefs.getAll', {});
  devMode.value = p['general.developerMode'] === true;
  window.openpet.on('app.prefs.changed', (c) => {
    if (c.key === 'general.developerMode') devMode.value = c.value === true;
    if (c.key.startsWith('model.') || c.key.startsWith('budget.')) void refreshFooter();
  });
});
const navTree = computed(() =>
  NAV_TREE.map((g) =>
    g.id === 'system'
      ? { ...g, children: g.children.filter((c) => c.id !== 'system.trace' || devMode.value) }
      : g,
  ),
);
</script>
<template>
  <div class="ds-window-bg flex h-screen p-4 text-base">
    <ToastHost ref="toast" />
    <section class="ds-glass flex h-full min-h-0 w-full overflow-hidden rounded-panel">
      <!-- 左导航 280px -->
      <nav class="flex w-[280px] shrink-0 flex-col border-r border-glass-border p-4">
        <div class="mb-5 flex items-center gap-3 px-1">
          <span class="ds-avatar h-8 w-8 text-sm">o</span>
          <div class="min-w-0">
            <div class="truncate text-md font-semibold text-text-main">openpet P0</div>
            <div class="text-sm text-text-sub">{{ t('settings.shell.subtitle') }}</div>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto pr-1">
          <template v-for="g in navTree" :key="g.id">
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
              <span>{{ t(g.label) }}</span>
            </button>
            <!-- AstrBot 式折叠组：组标题可点展开/收起，默认收起、当前路由所在组自动展开 -->
            <button
              v-else
              class="mt-3 flex w-full items-center gap-3 rounded-btn px-3 py-1.5 text-left text-sm transition ease-ds hover:text-text-main"
              :class="groupActive(g.id) ? 'text-text-main' : 'text-text-sub'"
              @click="toggleGroup(g.id)"
            >
              <component :is="g.icon" :size="16" :stroke-width="1.5" />
              <span class="flex-1">{{ t(g.label) }}</span>
              <ChevronDown
                :size="14"
                :stroke-width="1.5"
                class="transition-transform ease-ds"
                :class="openGroups.has(g.id) ? '' : '-rotate-90'"
              />
            </button>
            <template v-if="g.children.length === 0 || openGroups.has(g.id)">
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
                {{ t(c.label) }}
              </button>
            </template>
          </template>
        </div>

        <div class="mt-4 rounded-panel border border-glass-border bg-white/30 p-3">
          <div class="flex items-center gap-3">
            <span class="ds-avatar h-11 w-11 text-base">{{ t('settings.shell.avatarInitial') }}</span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-base font-medium text-text-main">{{ t('settings.shell.demoCharacterName') }}</div>
              <div class="flex items-center gap-1 text-sm text-text-sub">
                <span class="h-1.5 w-1.5 rounded-full" style="background: var(--ds-success)" />
                {{ t('settings.shell.online') }}
              </div>
            </div>
            <button class="ds-icon-button" :title="t('settings.shell.characterSettings')" :aria-label="t('settings.shell.characterSettings')">
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
            <button class="ds-icon-button" :title="t('settings.shell.collapseNav')" :aria-label="t('settings.shell.collapseNav')">
              <Menu :size="17" :stroke-width="1.5" />
            </button>
            <button class="ds-icon-button" :title="t('settings.shell.back')" :aria-label="t('settings.shell.back')">
              <ChevronLeft :size="17" :stroke-width="1.5" />
            </button>
            <button class="ds-icon-button" :title="t('settings.shell.forward')" :aria-label="t('settings.shell.forward')">
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
                :placeholder="t('settings.shell.searchPlaceholder')"
              />
              <span
                class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-btn border border-glass-border px-2 py-0.5 text-xs text-text-sub"
              >
                Ctrl + K
              </span>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button class="ds-icon-button" :title="t('settings.shell.new')" :aria-label="t('settings.shell.new')">
              <Plus :size="17" :stroke-width="1.5" />
            </button>
            <span class="mx-1 h-5 w-px bg-glass-border" />
            <button class="ds-icon-button" :title="t('settings.shell.theme')" :aria-label="t('settings.shell.theme')">
              <Sun :size="17" :stroke-width="1.5" />
            </button>
            <button class="ds-icon-button" :title="t('settings.shell.notifications')" :aria-label="t('settings.shell.notifications')">
              <Bell :size="17" :stroke-width="1.5" />
            </button>
            <span class="ds-avatar h-8 w-8 text-sm">{{ t('settings.shell.avatarInitial') }}</span>
            <span class="text-sm font-medium text-text-main">{{ t('settings.shell.demoCharacterName') }}</span>
            <button class="ds-icon-button" :title="t('settings.shell.minimize')" :aria-label="t('settings.shell.minimize')">
              <Minus :size="16" :stroke-width="1.5" />
            </button>
            <button class="ds-icon-button" :title="t('common.close')" :aria-label="t('common.close')">
              <X :size="16" :stroke-width="1.5" />
            </button>
          </div>
        </header>
        <main
          class="min-h-0 flex-1 p-6"
          :class="active === 'conversation.chat' || active === 'overview' ? 'flex flex-col' : 'overflow-y-auto'"
        >
          <div class="mb-5 flex shrink-0 items-end justify-between gap-4">
            <div>
              <div class="text-sm text-text-sub">{{ activeMeta.group }}</div>
              <h1 class="mt-1 text-xl font-semibold leading-tight text-text-main">
                {{ activeMeta.leaf }}
              </h1>
            </div>
            <div
              class="rounded-full border border-glass-border bg-white/30 px-3 py-1 text-sm text-text-sub"
            >
              {{ t('settings.shell.prefsSynced') }}
            </div>
          </div>
          <OverviewPage v-if="active === 'overview'" @navigate="active = $event" />
          <ChatPage v-else-if="active === 'conversation.chat'" :readonly-session-id="readonlySessionId" />
          <HistoryPage
            v-else-if="active === 'conversation.history'"
            @navigate="active = $event"
            @view-im="viewImSession"
          />
          <GeneralPage v-else-if="active === 'system.general'" @saved="saved" />
          <DisplayPage v-else-if="active === 'system.display'" @saved="saved" />
          <PrivacyPage v-else-if="active === 'system.privacy'" @saved="saved" />
          <ModelApiPage v-else-if="active === 'model'" @saved="saved" />
          <McpToolsPage v-else-if="active === 'tools'" />
          <ConnectionsPage v-else-if="active === 'connections'" @saved="saved" />
          <PluginsPage v-else-if="active === 'plugins'" />
          <KnowledgePage v-else-if="active === 'knowledge'" />
          <PersonaPage v-else-if="active === 'conversation.persona'" />
          <MemoryPage v-else-if="active === 'conversation.memory'" />
          <DataPage v-else-if="active === 'system.data'" />
          <VoicePage v-else-if="active === 'system.voice'" @saved="saved" @navigate="active = $event" />
          <CharacterLibraryPage v-else-if="active === 'character.library'" @edit="openEditor" />
          <CharacterEditorPage
            v-else-if="active === 'character.editor'"
            :initial-id="editCharacterId"
            @navigate="active = $event"
          />
          <TracePage v-else-if="active === 'system.trace'" />
          <HotkeysPage v-else-if="active === 'system.hotkeys'" @saved="saved" />
          <AboutPage v-else-if="active === 'system.about'" />
          <div v-else class="ds-glass rounded-panel p-6 text-text-sub">
            {{ t('settings.shell.placeholderPage', { page: activeMeta.leaf }) }}
          </div>
        </main>
        <footer
          class="flex h-8 shrink-0 items-center justify-between border-t border-glass-border px-4 text-sm text-text-sub"
        >
          <div class="flex items-center gap-4">
            <span class="flex items-center gap-1">
              <Activity :size="13" :stroke-width="1.5" />
              {{ t('settings.shell.running') }}
            </span>
            <span class="flex items-center gap-1">
              <Wifi :size="13" :stroke-width="1.5" />
              {{ t('settings.shell.connected') }}
            </span>
          </div>
          <div class="flex items-center gap-4">
            <span v-if="footerModel">{{ t('settings.shell.modelLabel') }}{{ footerModel }}</span>
            <span class="flex items-center gap-2">
              Token: {{ footerToken.text }}
              <span
                v-if="footerToken.pct !== null"
                class="h-1 w-20 overflow-hidden rounded-full bg-glass-border"
              >
                <span
                  class="block h-full"
                  :style="{
                    width: `${footerToken.pct}%`,
                    background: 'linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))',
                  }"
                />
              </span>
            </span>
            <span v-if="appVersion">v{{ appVersion }}</span>
          </div>
        </footer>
      </div>
    </section>
  </div>
</template>
