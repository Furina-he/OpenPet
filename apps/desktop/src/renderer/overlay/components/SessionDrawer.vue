<!-- overlay/components/SessionDrawer.vue — B3 浮层左抽屉（280px）：会话列表 + 新建；
     管理操作（改名/置顶/删除/导出）归 Hub 历史页，这里只做切换。IM 行只读置灰。 -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Plus, X } from 'lucide-vue-next';
import type { z } from 'zod';
import type { Methods } from '@openpet/protocol';
import {
  splitSessions,
  formatSessionTime,
  newSessionId,
  type SessionVm,
} from '../../settings/history-view.js';

type SessionsResult = z.infer<(typeof Methods)['chat.sessions']['result']>;

const props = defineProps<{ activeId: string }>();
const emit = defineEmits<{ close: []; switched: [] }>();
const { t } = useI18n();
const sessions = ref<SessionVm[]>([]);

onMounted(async () => {
  const r = (await window.openpet.rpc('chat.sessions', {})) as SessionsResult;
  sessions.value = r.sessions;
});

function timeLabel(ts: number): string {
  const f = formatSessionTime(ts, Date.now());
  return f.kind === 'yesterday' ? t('overlay.drawer.yesterday') : f.text;
}

async function pick(s: SessionVm): Promise<void> {
  if (s.origin === 'im' || s.id === props.activeId) return;
  await window.openpet.rpc('chat.setActiveSession', { sessionId: s.id });
  emit('switched');
}

async function create(): Promise<void> {
  await window.openpet.rpc('chat.setActiveSession', { sessionId: newSessionId(Date.now()) });
  emit('switched');
}
</script>

<template>
  <div class="absolute inset-y-0 left-0 z-30 flex w-[280px] flex-col border-r border-glass-border"
    style="background: var(--ds-glass-bg); backdrop-filter: blur(24px)"
  >
    <div class="flex h-11 shrink-0 items-center justify-between border-b border-glass-border px-3">
      <span class="text-sm font-semibold text-text-main">{{ t('overlay.drawer.title') }}</span>
      <div class="flex items-center gap-1">
        <button class="ds-icon-button" :title="t('settings.chat.newSession')" :aria-label="t('settings.chat.newSession')" @click="create">
          <Plus :size="16" :stroke-width="1.5" />
        </button>
        <button class="ds-icon-button" :title="t('common.close')" :aria-label="t('common.close')" @click="emit('close')">
          <X :size="16" :stroke-width="1.5" />
        </button>
      </div>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto p-2">
      <template v-for="group in ([splitSessions(sessions, '').pinned, splitSessions(sessions, '').recent] as const)">
        <button
          v-for="s in group"
          :key="s.id"
          class="mb-1 flex h-16 w-full items-center gap-2 rounded-panel border px-3 text-left transition ease-ds"
          :class="[
            s.id === props.activeId ? '' : 'border-transparent',
            s.origin === 'im' ? 'opacity-50' : 'hover:bg-white/30',
          ]"
          :style="s.id === props.activeId ? { borderColor: 'var(--ds-brand-from)' } : {}"
          @click="pick(s)"
        >
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-semibold text-text-main">
              {{ s.title }}
              <span v-if="s.origin === 'im'" class="ml-1 text-xs text-text-sub">IM</span>
            </div>
            <div class="truncate text-xs text-text-sub">{{ s.lastText }}</div>
          </div>
          <span class="shrink-0 text-xs text-text-sub">{{ timeLabel(s.lastTs) }}</span>
        </button>
      </template>
      <div v-if="sessions.length === 0" class="p-4 text-center text-sm text-text-sub">
        {{ t('overlay.drawer.empty') }}
      </div>
    </div>
  </div>
</template>
