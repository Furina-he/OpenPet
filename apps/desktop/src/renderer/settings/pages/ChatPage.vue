<!-- apps/desktop/src/renderer/settings/pages/ChatPage.vue — Hub 完整会话视图（C′ §3b，照 AstrBot Chat.vue）
     左：消息流 + 工具调用卡 + 输入区；右：推理侧栏（可折叠）。
     复用 overlay 的 ChatView 会话模型 + 现有 chat.snapshot/stream/send；新增消费 chat.reasoning/chat.toolCall。
     桌宠浮层（B1）不碰；reasoning/tool 只在 Hub 呈现，气泡只含干净回复。 -->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChatView, explodeSegments, isEmptyReply, type ChatMessage } from '../../overlay/chat-view';
import ReasoningSidebar from '../../components/chat/ReasoningSidebar.vue';
import ToolCallCard from '../../components/chat/ToolCallCard.vue';
import ChatInput from '../../components/chat/ChatInput.vue';
import { resolveActiveSession, newSessionId } from '../history-view.js';

// 会话管理：sessionId 由 prefs 指针驱动（chat.activeSessions[当前角色]，Hub/浮层共享）；
// readonlySessionId 传入 = 只读查看 IM 会话（不写指针，离开页面即退出）。
const props = defineProps<{ readonlySessionId?: string | null }>();
const { t } = useI18n();
const sessionId = ref('default');
const sessionTitle = ref('');
const readonly = computed(() => Boolean(props.readonlySessionId));

type ToolCall = {
  id: string;
  name: string;
  args?: unknown;
  phase: 'pending' | 'result' | 'error';
  result?: string;
};

const messages = ref<ChatMessage[]>([]);
/** ⑭ 显示列表：带 newBubble 分段点的消息拆多气泡（display-only）。 */
const displayMessages = computed(() => explodeSegments(messages.value));
const streaming = ref(false);
const ready = ref(false);
const draft = ref('');
const lastDoneError = ref<{ kind?: string; message?: string } | null>(null);
const reasoningItems = ref<{ sessionId: string; text: string }[]>([]);
const toolCalls = ref<ToolCall[]>([]);
const sidebarCollapsed = ref(false);
const scroller = ref<HTMLElement | null>(null);
const unsubs: Array<() => void> = [];

let view = new ChatView(sessionId.value, () => {
  messages.value = view.messages.map((m) => ({ ...m }));
  streaming.value = view.streaming;
});

/** 解析指针 → 重建 ChatView + 重拉快照（切会话/切角色/新建后都走这里）。 */
async function rebuild(): Promise<void> {
  if (props.readonlySessionId) {
    sessionId.value = props.readonlySessionId;
  } else {
    const [prefs, cur] = await Promise.all([
      window.openpet.rpc('app.prefs.getAll', {}),
      window.openpet.rpc('character.current', {}),
    ]);
    sessionId.value = resolveActiveSession(
      prefs['chat.activeSessions'] as Record<string, string>,
      cur.characterId,
    );
  }
  ready.value = false;
  reasoningItems.value = [];
  toolCalls.value = [];
  view = new ChatView(sessionId.value, () => {
    messages.value = view.messages.map((m) => ({ ...m }));
    streaming.value = view.streaming;
  });
  messages.value = [];
  try {
    const [snap, sessions] = await Promise.all([
      window.openpet.rpc('chat.snapshot', { sessionId: sessionId.value }),
      window.openpet.rpc('chat.sessions', {}),
    ]);
    view.applySnapshot(snap as never);
    sessionTitle.value =
      sessions.sessions.find((s) => s.id === sessionId.value)?.title ??
      t('settings.chat.untitledSession');
  } catch {
    sessionTitle.value = t('settings.chat.untitledSession');
  } finally {
    ready.value = true;
  }
  scrollToBottom();
}

async function newSession(): Promise<void> {
  await window.openpet.rpc('chat.setActiveSession', { sessionId: newSessionId(Date.now()) });
  // prefs.changed 订阅触发 rebuild → 空聊天区
}

const hasReasoning = computed(() => reasoningItems.value.length > 0);

function scrollToBottom(): void {
  void nextTick(() => {
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

watch([messages, toolCalls], scrollToBottom, { deep: true });

onMounted(async () => {
  unsubs.push(
    window.openpet.on('chat.stream', (p) => view.onStream(p as never)),
    window.openpet.on('chat.done', (p) => {
      // 失败 done 暴露 errorKind/message，便于用户与排查（替代笼统「请稍后重试」）。
      lastDoneError.value =
        p.finishReason === 'error' ? { kind: p.errorKind, message: p.error } : null;
      view.onDone(p as never);
    }),
    window.openpet.on('chat.reasoning', (p) => {
      if (p.sessionId !== sessionId.value) return;
      reasoningItems.value.push({ sessionId: p.sessionId, text: p.text });
      if (sidebarCollapsed.value) sidebarCollapsed.value = false; // 有推理自动展开
    }),
    window.openpet.on('chat.toolCall', (p) => {
      if (p.sessionId !== sessionId.value) return;
      const call = p.call as ToolCall;
      const idx = toolCalls.value.findIndex((c) => c.id === call.id);
      if (idx >= 0) toolCalls.value[idx] = call;
      else toolCalls.value.push(call);
    }),
    window.openpet.on('app.prefs.changed', (p) => {
      if ((p as { key?: string }).key === 'chat.activeSessions' && !props.readonlySessionId) {
        void rebuild();
      }
    }),
    window.openpet.on('character.changed', () => void rebuild()),
  );
  await rebuild();
});

watch(
  () => props.readonlySessionId,
  () => void rebuild(),
);

onUnmounted(() => {
  for (const u of unsubs) u();
});

async function send(): Promise<void> {
  if (readonly.value || streaming.value || !ready.value || !draft.value.trim()) return;
  const text = draft.value;
  // 新一轮：清空上一轮的推理/工具呈现（reasoning 即发即弃，不留历史）
  reasoningItems.value = [];
  toolCalls.value = [];
  view.echoUser(text);
  draft.value = '';
  scrollToBottom();
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

function isTyping(m: ChatMessage): boolean {
  return streaming.value && m.role === 'assistant' && m.text === '' && m.finishReason === null;
}
</script>

<template>
  <div class="flex h-full min-h-0 gap-4">
    <!-- 主列：消息流 + 工具卡 + 输入 -->
    <div class="ds-glass flex min-w-0 flex-1 flex-col overflow-hidden rounded-panel">
      <!-- 会话头：标题 + 新建（只读态显示来源提示） -->
      <div class="flex h-11 shrink-0 items-center justify-between border-b border-glass-border px-4">
        <div class="flex min-w-0 items-center gap-2">
          <span class="truncate text-sm font-semibold text-text-main">{{ sessionTitle }}</span>
          <span
            v-if="readonly"
            class="shrink-0 rounded-full border border-glass-border px-2 py-0.5 text-xs text-text-sub"
          >
            {{ t('settings.chat.readonlyBanner') }}
          </span>
        </div>
        <button
          v-if="!readonly"
          class="shrink-0 rounded-btn border border-glass-border px-3 py-1 text-sm text-text-sub transition ease-ds hover:text-text-main"
          @click="newSession"
        >
          ＋ {{ t('settings.chat.newSession') }}
        </button>
      </div>
      <div ref="scroller" class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div
          v-for="(m, i) in displayMessages"
          :key="i"
          class="flex items-start gap-2"
          :class="m.role === 'user' ? 'flex-row-reverse' : ''"
        >
          <span
            class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
            :class="m.role === 'assistant' ? 'ds-avatar' : ''"
            :style="
              m.role === 'user'
                ? 'background: var(--ds-cool-soft); color: var(--ds-text-main); border: 1px solid var(--ds-glass-border)'
                : ''
            "
          >
            {{ m.role === 'assistant' ? t('settings.shell.avatarInitial') : t('settings.chat.you') }}
          </span>
          <div
            class="max-w-[78%] rounded-bubble px-3.5 py-2.5 text-base leading-relaxed"
            :style="
              m.role === 'user'
                ? 'background: linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to)); color: #fff'
                : 'background: var(--ds-glass-bg); border: 1px solid var(--ds-glass-border); color: var(--ds-text-main)'
            "
          >
            <span v-if="isTyping(m)" class="flex items-center gap-1 py-1">
              <span
                class="h-1.5 w-1.5 animate-pulse rounded-full"
                style="background: var(--ds-text-sub)"
              />
              <span
                class="h-1.5 w-1.5 animate-pulse rounded-full"
                style="background: var(--ds-text-sub); animation-delay: 0.15s"
              />
              <span
                class="h-1.5 w-1.5 animate-pulse rounded-full"
                style="background: var(--ds-text-sub); animation-delay: 0.3s"
              />
            </span>
            <span
              v-else-if="m.role === 'assistant' && m.finishReason === 'error'"
              style="color: var(--ds-danger)"
            >
              {{ t('settings.chat.replyError', { kind: m.errorKind ?? lastDoneError?.kind ?? t('settings.chat.unknown') }) }}<template
                v-if="lastDoneError?.message"
              >
                {{ ': ' + lastDoneError.message }}</template
              >
            </span>
            <span v-else-if="isEmptyReply(m)" class="italic text-text-sub">
              {{ t('settings.chat.emptyReply') }}
            </span>
            <span v-else class="whitespace-pre-wrap break-words">{{ m.text }}</span>
          </div>
        </div>

        <!-- 本轮工具调用卡 -->
        <div v-if="toolCalls.length" class="space-y-2 pl-10">
          <ToolCallCard v-for="c in toolCalls" :key="c.id" :call="c" />
        </div>

        <!-- 空态 -->
        <div
          v-if="ready && messages.length === 0 && toolCalls.length === 0"
          class="flex h-full flex-col items-center justify-center text-text-sub"
        >
          <span class="ds-avatar mb-3 flex h-12 w-12 items-center justify-center text-lg">{{ t('settings.shell.avatarInitial') }}</span>
          <p class="text-base">{{ t('settings.chat.emptyHint') }}</p>
        </div>
      </div>

      <div v-if="!readonly" class="border-t border-glass-border p-3">
        <ChatInput
          v-model="draft"
          :disabled="!ready"
          :streaming="streaming"
          @send="send"
          @cancel="cancel"
        />
      </div>
    </div>

    <!-- 推理侧栏：有推理或展开态时常驻；否则窄轨 -->
    <ReasoningSidebar
      :items="reasoningItems"
      :collapsed="sidebarCollapsed || !hasReasoning"
      :streaming="streaming"
      @toggle="sidebarCollapsed = !sidebarCollapsed"
    />
  </div>
</template>
