<!-- apps/desktop/src/renderer/overlay/App.vue — B1 聊天浮层（ui-design §6.1；视觉 UI/60ea4a18 B1 区）
     复用 chat-view 会话模型；玻璃 + 顶栏（角色名/模型/连接态/工具组）+ 头像气泡列表 + 输入行。
     ?fixture=chat：注入假快照做视觉 harness（不连 Main）。 -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Bookmark, History, Loader2, Mic, Paperclip, Send, Settings, Square, X } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { ChatView } from './chat-view';
import type { ChatMessage } from './chat-view';
import { groupMessages } from './bubble-view';
import Bubble from './components/Bubble.vue';
import SessionDrawer from './components/SessionDrawer.vue';
import { createVoiceRecorder } from '../components/chat/use-voice-record';
import { resolveActiveSession } from '../settings/history-view.js';
import type { ErrorAction } from './error-copy';

// 会话管理：sessionId 由 prefs 指针驱动（与 Hub 同一会话、同步切换）；fixture 保持 default。
const { t } = useI18n();
const sessionId = ref('default');
const drawerOpen = ref(false);
const messages = ref<ChatMessage[]>([]);
const streaming = ref(false);
const ready = ref(false);
const draft = ref('');
const emotion = ref('');
const charName = ref(t('overlay.defaultCharName'));
const modelLabel = ref(t('overlay.notConnected'));
const connected = ref(false);
const unsubs: Array<() => void> = [];

let view = new ChatView(sessionId.value, () => {
  messages.value = view.messages.map((m) => ({ ...m }));
  streaming.value = view.streaming;
});

const isFixture = new URLSearchParams(window.location.search).get('fixture') === 'chat';

/** 解析指针 → 重建 ChatView + 重拉快照（切会话/切角色/新建后都走这里）。 */
async function rebuild(): Promise<void> {
  const [prefs, cur] = await Promise.all([
    window.openpet.rpc('app.prefs.getAll', {}),
    window.openpet.rpc('character.current', {}).catch(() => null),
  ]);
  sessionId.value = cur
    ? resolveActiveSession(
        prefs['chat.activeSessions'] as Record<string, string>,
        cur.characterId,
      )
    : 'default';
  ready.value = false;
  view = new ChatView(sessionId.value, () => {
    messages.value = view.messages.map((m) => ({ ...m }));
    streaming.value = view.streaming;
  });
  messages.value = [];
  try {
    const snap = await window.openpet.rpc('chat.snapshot', { sessionId: sessionId.value });
    view.applySnapshot(snap as never);
  } catch {
    /* 失败也放行输入 */
  }
  ready.value = true;
}

onMounted(async () => {
  if (isFixture) {
    view.applySnapshot({
      sessionId: sessionId.value,
      seq: 3,
      streaming: false,
      messages: [
        { role: 'user', text: '你好呀', finishReason: null },
        { role: 'assistant', text: '嗨~ 我是小灵，很高兴见到你！', finishReason: 'stop' },
        { role: 'user', text: '给我讲个笑话', finishReason: null },
        {
          role: 'assistant',
          text: '为什么程序员分不清万圣节和圣诞节？因为 Oct 31 == Dec 25 ：)',
          finishReason: 'stop',
        },
        { role: 'user', text: '在吗', finishReason: null },
        { role: 'assistant', text: '', finishReason: 'error', errorKind: 'auth' },
      ],
    });
    charName.value = t('overlay.defaultCharName');
    modelLabel.value = 'gpt-4o';
    connected.value = true;
    ready.value = true;
    return;
  }
  unsubs.push(
    window.openpet.on('chat.stream', (p) => view.onStream(p as never)),
    window.openpet.on('chat.done', (p) => view.onDone(p as never)),
    window.openpet.on('behavior.applyEmotion', (p) => {
      emotion.value = (p as { name: string }).name;
    }),
    window.openpet.on('behavior.setIntent', (p) => {
      emotion.value = (p as { mood: string }).mood;
    }),
    window.openpet.on('chat.done', () => {
      emotion.value = ''; // 流结束清空（错误/正常都清）
    }),
    window.openpet.on('app.prefs.changed', (p) => {
      if ((p as { key?: string }).key === 'chat.activeSessions') void rebuild();
    }),
    window.openpet.on('character.changed', () => void rebuild()),
  );
  try {
    const [char, prefs] = await Promise.all([
      window.openpet.rpc('character.current', {}).catch(() => null),
      window.openpet.rpc('app.prefs.getAll', {}).catch(() => null),
    ]);
    await rebuild();
    if (char && (char as { manifest?: { name?: string } }).manifest?.name) {
      charName.value = (char as { manifest: { name: string } }).manifest.name;
    }
    // 批次⑥ arch#4：模型标签/连接态改读新工作台默认 chat 模型（id 形如 `sourceId/model`，取 model 段展示）。
    const modelId = (prefs as Record<string, unknown> | null)?.['model.defaultChatModelId'];
    if (typeof modelId === 'string' && modelId) {
      modelLabel.value = modelId.split('/').pop() ?? modelId;
      connected.value = true;
    }
  } catch {
    ready.value = true; // 失败也放行输入（错误态在发送时反馈）
  }
});

onUnmounted(() => {
  for (const u of unsubs) u();
});

async function send(): Promise<void> {
  if (streaming.value || !ready.value || !draft.value.trim()) return;
  const text = draft.value;
  view.echoUser(text);
  draft.value = '';
  try {
    await window.openpet.rpc('chat.send', { sessionId: sessionId.value, text });
  } catch {
    view.rollbackEcho();
  }
}
function cancel(): void {
  if (!streaming.value) return;
  void window.openpet.rpc('chat.cancel', { sessionId: sessionId.value });
}
function openHub(): void {
  void window.openpet.rpc('app.window.openHub', {});
}
function closeOverlay(): void {
  // 不用 window.close()：sandbox renderer 下它绕过 Main 的 close→hide 拦截直接销毁窗口，
  // 之后双击/托盘/热键的 showChat 全部失效（2026-07 实测）。收起一律走 Main。
  void window.openpet.rpc('app.window.hideSelf', {});
}
function lastUserText(): string {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const m = messages.value[i]!;
    if (m.role === 'user') return m.text;
  }
  return '';
}
async function onAction(a: ErrorAction): Promise<void> {
  if (a === 'retry') {
    const text = lastUserText();
    if (!text || streaming.value) return;
    view.echoUser(text);
    try {
      await window.openpet.rpc('chat.send', { sessionId: sessionId.value, text });
    } catch {
      view.rollbackEcho();
    }
    return;
  }
  openHub(); // switchModel / changeKey → Hub D3
}
// 情绪 chip 只挂在「最后一条、流式中的 assistant」气泡。
function emotionFor(m: ChatMessage): string {
  const last = messages.value[messages.value.length - 1];
  return streaming.value && m === last && m.role === 'assistant' ? emotion.value : '';
}

// F-VC 语音输入（与 Hub ChatInput 共用 composable，点击切换式）：转写追加进草稿，不自动发送。
const {
  state: voiceState,
  micError,
  elapsedMs,
  toggle: toggleRecord,
} = createVoiceRecorder({
  enabled: () => ready.value && !isFixture,
  onText: (text) => {
    draft.value += text;
  },
});
const recordLabel = computed(() => {
  const s = Math.floor(elapsedMs.value / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
});
</script>

<template>
  <div
    class="ds-glass relative flex h-screen flex-col overflow-hidden rounded-panel text-base text-text-main"
  >
    <SessionDrawer
      v-if="drawerOpen"
      :active-id="sessionId"
      @close="drawerOpen = false"
      @switched="drawerOpen = false"
    />
    <!-- 顶栏：角色名 + 模型 + 连接态 + 工具 -->
    <header class="flex items-center justify-between border-b border-glass-border px-4 py-3">
      <div class="flex min-w-0 items-center gap-3">
        <span class="ds-avatar h-9 w-9 shrink-0 text-sm">{{ charName.slice(0, 1) }}</span>
        <div class="min-w-0">
          <div class="truncate text-md font-semibold">{{ charName }}</div>
          <div class="flex items-center gap-2 text-sm text-text-sub">
            <span class="truncate">{{ modelLabel }}</span>
            <span
              class="h-2 w-2 shrink-0 rounded-full"
              :style="`background: ${connected ? 'var(--ds-success)' : 'var(--ds-danger)'}`"
              :title="connected ? t('settings.shell.connected') : t('overlay.modelNotConnected')"
            />
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="ds-icon-button border border-glass-border"
          :title="t('overlay.drawer.title')"
          :aria-label="t('overlay.drawer.title')"
          @click="drawerOpen = !drawerOpen"
        >
          <History :size="17" :stroke-width="1.5" />
        </button>
        <button class="ds-icon-button border border-glass-border" :title="t('settings.nav.memory')" :aria-label="t('settings.nav.memory')" disabled>
          <Bookmark :size="17" :stroke-width="1.5" />
        </button>
        <button class="ds-icon-button border border-glass-border" :title="t('settings.nav.voice')" :aria-label="t('settings.nav.voice')" disabled>
          <Mic :size="17" :stroke-width="1.5" />
        </button>
        <button class="ds-icon-button border border-glass-border" :title="t('settings.nav.general')" :aria-label="t('settings.nav.general')" @click="openHub">
          <Settings :size="17" :stroke-width="1.5" />
        </button>
        <button
          class="ds-icon-button border border-glass-border"
          :title="t('common.close')"
          :aria-label="t('common.close')"
          @click="closeOverlay"
        >
          <X :size="17" :stroke-width="1.5" />
        </button>
      </div>
    </header>

    <!-- 消息列表：按 role 分组，组内共享头像 -->
    <main class="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div
        v-for="(g, gi) in groupMessages(messages)"
        :key="gi"
        class="flex items-start gap-2"
        :class="g.role === 'user' ? 'flex-row-reverse' : ''"
      >
        <div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
          <span
            class="flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold"
            :class="g.role === 'assistant' ? 'ds-avatar' : ''"
            :style="
              g.role === 'user'
                ? 'background: var(--ds-cool-soft); color: var(--ds-text-main); border: 1px solid var(--ds-glass-border)'
                : ''
            "
          >
            {{ g.role === 'assistant' ? charName.slice(0, 1) : t('settings.chat.you') }}
          </span>
        </div>
        <div
          class="flex min-w-0 flex-1 flex-col gap-1"
          :class="g.role === 'user' ? 'items-end' : 'items-start'"
        >
          <Bubble
            v-for="(m, mi) in g.messages"
            :key="mi"
            :message="m"
            :streaming="streaming"
            :emotion="emotionFor(m)"
            @action="onAction"
          />
        </div>
      </div>
    </main>

    <!-- 输入行 -->
    <footer class="border-t border-glass-border p-3">
      <div class="ds-control flex items-center gap-2 rounded-panel px-3 py-2">
        <button class="ds-icon-button min-h-8 min-w-8" :title="t('overlay.attach')" :aria-label="t('overlay.attach')" disabled>
          <Paperclip :size="17" :stroke-width="1.5" />
        </button>
        <input
          v-model="draft"
          class="min-w-0 flex-1 bg-transparent px-1 text-base outline-none"
          :placeholder="
            voiceState === 'recording'
              ? t('settings.chatInput.listening')
              : voiceState === 'transcribing'
                ? t('settings.chatInput.transcribing')
                : t('overlay.inputPlaceholder')
          "
          :disabled="!ready"
          @keydown.enter="send"
        />
        <span
          v-if="voiceState === 'recording'"
          class="flex shrink-0 items-center gap-1 font-mono text-xs text-danger"
        >
          <span class="h-2 w-2 animate-pulse rounded-full bg-danger" />
          {{ recordLabel }}
        </span>
        <span v-else class="shrink-0 font-mono text-xs text-text-sub">120 t</span>
        <button
          class="ds-icon-button min-h-8 min-w-8 select-none"
          :class="voiceState === 'recording' || micError ? 'text-danger' : ''"
          :title="
            voiceState === 'recording'
              ? t('settings.chatInput.stopAndTranscribe')
              : voiceState === 'transcribing'
                ? t('settings.chatInput.transcribing')
                : t('settings.chatInput.voiceInput')
          "
          :aria-label="
            voiceState === 'recording'
              ? t('settings.chatInput.stopAndTranscribe')
              : voiceState === 'transcribing'
                ? t('settings.chatInput.transcribing')
                : t('settings.chatInput.voiceInput')
          "
          :disabled="!ready || voiceState === 'transcribing'"
          @click="toggleRecord"
        >
          <Square v-if="voiceState === 'recording'" :size="14" fill="currentColor" />
          <Loader2 v-else-if="voiceState === 'transcribing'" :size="17" class="animate-spin" />
          <Mic v-else :size="17" :stroke-width="1.5" />
        </button>
        <button
          v-if="!streaming"
          class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition ease-ds active:scale-[0.97] disabled:opacity-50"
          style="background: linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to))"
          :disabled="!ready || !draft.trim()"
          :title="t('settings.chatInput.send')"
          :aria-label="t('settings.chatInput.send')"
          @click="send"
        >
          <Send :size="17" :stroke-width="1.5" />
        </button>
        <button
          v-else
          class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-glass-border text-text-sub"
          :title="t('common.cancel')"
          :aria-label="t('common.cancel')"
          @click="cancel"
        >
          <Square :size="15" :stroke-width="1.5" />
        </button>
      </div>
    </footer>
  </div>
</template>
