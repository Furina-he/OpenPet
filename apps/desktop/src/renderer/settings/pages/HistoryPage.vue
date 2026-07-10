<!-- settings/pages/HistoryPage.vue — B3 会话历史（spec 2026-07-09-session-management）。
     搜索/置顶分组/64px 行/RowMenu（置顶·改名·导出·删除 undo）；IM 行只读（仅导出）。
     删除 undo = 页内内联条（ToastHost 无 action 支持）；toast 倒计时结束才真删。 -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { z } from 'zod';
import type { Methods } from '@openpet/protocol';
import RowMenu from '../components/RowMenu.vue';
import ToastHost from '../../components/ToastHost.vue';
import Input from '../../components/Input.vue';
import {
  splitSessions,
  formatSessionTime,
  resolveActiveSession,
  UndoTimers,
  type SessionVm,
} from '../history-view.js';

type SessionsResult = z.infer<(typeof Methods)['chat.sessions']['result']>;

const emit = defineEmits<{ navigate: [route: string]; viewIm: [sessionId: string] }>();
const { t } = useI18n();
const sessions = ref<SessionVm[]>([]);
const query = ref('');
const activeId = ref('default');
const characterId = ref('');
const renamingId = ref<string | null>(null);
const renameDraft = ref('');
const hiddenIds = ref<Set<string>>(new Set()); // undo 期间从列表隐藏
const pendingUndo = ref<{ id: string; title: string } | null>(null);
const undo = new UndoTimers(5000);
const toastHost = ref<InstanceType<typeof ToastHost> | null>(null);

async function load(): Promise<void> {
  const [r, cur, prefs] = await Promise.all([
    window.openpet.rpc('chat.sessions', {}),
    window.openpet.rpc('character.current', {}),
    window.openpet.rpc('app.prefs.getAll', {}),
  ]);
  sessions.value = (r as SessionsResult).sessions;
  characterId.value = cur.characterId;
  activeId.value = resolveActiveSession(
    prefs['chat.activeSessions'] as Record<string, string>,
    cur.characterId,
  );
}
onMounted(() => {
  void load();
  window.openpet.on('character.changed', () => void load());
});

const grouped = computed(() =>
  splitSessions(
    sessions.value.filter((s) => !hiddenIds.value.has(s.id)),
    query.value,
  ),
);
const isEmpty = computed(
  () => grouped.value.pinned.length === 0 && grouped.value.recent.length === 0,
);

function timeLabel(ts: number): string {
  const f = formatSessionTime(ts, Date.now());
  return f.kind === 'yesterday' ? t('settings.history.yesterday') : f.text;
}

const menuItems = (s: SessionVm): Array<{ key: string; label: string; danger?: boolean }> =>
  s.origin === 'im'
    ? [{ key: 'export', label: t('settings.history.menuExport') }]
    : [
        {
          key: 'pin',
          label: t(s.pinned ? 'settings.history.menuUnpin' : 'settings.history.menuPin'),
        },
        { key: 'rename', label: t('settings.history.menuRename') },
        { key: 'export', label: t('settings.history.menuExport') },
        { key: 'delete', label: t('settings.history.menuDelete'), danger: true },
      ];

async function openSession(s: SessionVm): Promise<void> {
  if (s.origin === 'im') {
    emit('viewIm', s.id);
    return;
  }
  await window.openpet.rpc('chat.setActiveSession', { sessionId: s.id });
  emit('navigate', 'conversation.chat');
}

async function onMenu(s: SessionVm, key: string): Promise<void> {
  if (key === 'pin') {
    await window.openpet.rpc('chat.sessionPin', { id: s.id, pinned: !s.pinned });
    await load();
  } else if (key === 'rename') {
    renamingId.value = s.id;
    renameDraft.value = s.title;
  } else if (key === 'export') {
    const r = await window.openpet.rpc('chat.sessionExport', { id: s.id });
    if (!r.cancelled)
      toastHost.value?.show('float', t('settings.history.exportedToast', { path: r.path }));
  } else if (key === 'delete') {
    hiddenIds.value = new Set([...hiddenIds.value, s.id]);
    pendingUndo.value = { id: s.id, title: s.title };
    undo.schedule(s.id, () => {
      if (pendingUndo.value?.id === s.id) pendingUndo.value = null;
      void window.openpet.rpc('chat.sessionDelete', { id: s.id }).then(load);
    });
  }
}

function undoDelete(): void {
  const p = pendingUndo.value;
  if (!p) return;
  undo.cancel(p.id);
  hiddenIds.value = new Set([...hiddenIds.value].filter((x) => x !== p.id));
  pendingUndo.value = null;
}

async function confirmRename(): Promise<void> {
  if (!renamingId.value || !renameDraft.value.trim()) {
    renamingId.value = null;
    return;
  }
  await window.openpet.rpc('chat.sessionRename', {
    id: renamingId.value,
    title: renameDraft.value.trim(),
  });
  renamingId.value = null;
  await load();
}
</script>

<template>
  <div class="mx-auto max-w-[760px] space-y-4">
    <ToastHost ref="toastHost" />

    <!-- 删除 undo 内联条（§2.8①：5s 撤销窗口） -->
    <div
      v-if="pendingUndo"
      class="ds-glass flex items-center justify-between rounded-panel border border-glass-border px-4 py-2 text-sm"
    >
      <span class="text-text-main">{{ t('settings.history.deletedToast', { title: pendingUndo.title }) }}</span>
      <button class="font-semibold" style="color: var(--ds-brand-to)" @click="undoDelete">
        {{ t('settings.history.undo') }}
      </button>
    </div>

    <Input v-model="query" :placeholder="t('settings.history.searchPlaceholder')" />

    <div v-if="isEmpty" class="ds-glass rounded-panel p-10 text-center text-text-sub">
      {{ t('settings.history.empty') }}
    </div>

    <template v-for="group in ([['pinnedGroup', grouped.pinned], ['recentGroup', grouped.recent]] as const)" :key="group[0]">
      <div v-if="group[1].length" class="space-y-1">
        <div class="px-1 text-sm text-text-sub">{{ t(`settings.history.${group[0]}`) }}</div>
        <div
          v-for="s in group[1]"
          :key="s.id"
          class="ds-glass flex h-16 cursor-pointer items-center gap-3 rounded-panel border px-4 transition ease-ds hover:-translate-y-0.5"
          :class="s.id === activeId ? '' : 'border-glass-border'"
          :style="s.id === activeId ? { borderColor: 'var(--ds-brand-from)' } : {}"
          @click="openSession(s)"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <template v-if="renamingId === s.id">
                <input
                  v-model="renameDraft"
                  class="ds-control h-7 rounded-input px-2 text-sm"
                  :placeholder="t('settings.history.renamePrompt')"
                  @click.stop
                  @keyup.enter="confirmRename"
                  @blur="confirmRename"
                />
              </template>
              <template v-else>
                <span class="truncate text-base font-semibold text-text-main">{{ s.title }}</span>
                <span
                  v-if="s.origin === 'im'"
                  class="shrink-0 rounded-full border border-glass-border px-1.5 text-xs text-text-sub"
                >
                  {{ t('settings.history.imChip') }}
                </span>
                <span
                  v-if="s.id === activeId"
                  class="shrink-0 rounded-full px-1.5 text-xs text-white"
                  :style="{ background: 'linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))' }"
                >
                  {{ t('settings.history.current') }}
                </span>
              </template>
            </div>
            <div class="truncate text-sm text-text-sub">{{ s.lastText }}</div>
          </div>
          <div class="shrink-0 text-right text-xs text-text-sub">
            <div>{{ timeLabel(s.lastTs) }}</div>
            <div>{{ t('settings.history.msgCount', { n: s.count }) }}</div>
          </div>
          <div class="shrink-0" @click.stop>
            <RowMenu :items="menuItems(s)" @select="(k) => onMenu(s, k)" />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
