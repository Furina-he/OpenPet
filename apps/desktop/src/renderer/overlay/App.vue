<!-- apps/desktop/src/renderer/overlay/App.vue — B1 聊天浮层（ui-design §6.1；视觉 UI/60ea4a18 B1 区）
     复用 chat-view 会话模型；玻璃 + 顶栏（角色名/模型/连接态/工具组）+ 头像气泡列表 + 输入行。
     ?fixture=chat：注入假快照做视觉 harness（不连 Main）。 -->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { Bookmark, Mic, Paperclip, Send, Settings, Square, X } from 'lucide-vue-next';
import { ChatView } from './chat-view';
import type { ChatMessage } from './chat-view';
import { groupMessages } from './bubble-view';
import Bubble from './components/Bubble.vue';
import type { ErrorAction } from './error-copy';

const SESSION_ID = 'default';
const messages = ref<ChatMessage[]>([]);
const streaming = ref(false);
const ready = ref(false);
const draft = ref('');
const emotion = ref('');
const charName = ref('小灵');
const modelLabel = ref('未连接');
const connected = ref(false);
const unsubs: Array<() => void> = [];

const view = new ChatView(SESSION_ID, () => {
  messages.value = view.messages.map((m) => ({ ...m }));
  streaming.value = view.streaming;
});

const isFixture = new URLSearchParams(window.location.search).get('fixture') === 'chat';

onMounted(async () => {
  if (isFixture) {
    view.applySnapshot({
      sessionId: SESSION_ID,
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
    charName.value = '小灵';
    modelLabel.value = 'gpt-4o';
    connected.value = true;
    ready.value = true;
    return;
  }
  unsubs.push(
    window.desksoul.on('chat.stream', (p) => view.onStream(p as never)),
    window.desksoul.on('chat.done', (p) => view.onDone(p as never)),
    window.desksoul.on('behavior.applyEmotion', (p) => {
      emotion.value = (p as { name: string }).name;
    }),
    window.desksoul.on('behavior.setIntent', (p) => {
      emotion.value = (p as { mood: string }).mood;
    }),
    window.desksoul.on('chat.done', () => {
      emotion.value = ''; // 流结束清空（错误/正常都清）
    }),
  );
  try {
    const [snap, char, prefs] = await Promise.all([
      window.desksoul.rpc('chat.snapshot', { sessionId: SESSION_ID }),
      window.desksoul.rpc('character.current', {}).catch(() => null),
      window.desksoul.rpc('app.prefs.getAll', {}).catch(() => null),
    ]);
    view.applySnapshot(snap as never);
    if (char && (char as { manifest?: { name?: string } }).manifest?.name) {
      charName.value = (char as { manifest: { name: string } }).manifest.name;
    }
    const model = (prefs as Record<string, unknown> | null)?.['model.activeModel'];
    if (typeof model === 'string' && model) {
      modelLabel.value = model;
      connected.value = true;
    }
    ready.value = true;
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
    await window.desksoul.rpc('chat.send', { sessionId: SESSION_ID, text });
  } catch {
    view.rollbackEcho();
  }
}
function cancel(): void {
  if (!streaming.value) return;
  void window.desksoul.rpc('chat.cancel', { sessionId: SESSION_ID });
}
function openHub(): void {
  void window.desksoul.rpc('app.window.openHub', {});
}
function closeOverlay(): void {
  window.close();
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
      await window.desksoul.rpc('chat.send', { sessionId: SESSION_ID, text });
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
</script>

<template>
  <div
    class="ds-glass flex h-screen flex-col overflow-hidden rounded-panel text-base text-text-main"
  >
    <!-- 顶栏：角色名 + 模型 + 连接态 + 工具 -->
    <header class="flex items-center justify-between border-b border-glass-border px-4 py-3">
      <div class="flex min-w-0 items-center gap-3">
        <span class="ds-avatar h-9 w-9 shrink-0 text-sm">小</span>
        <div class="min-w-0">
          <div class="truncate text-md font-semibold">{{ charName }}</div>
          <div class="flex items-center gap-2 text-sm text-text-sub">
            <span class="truncate">{{ modelLabel }}</span>
            <span
              class="h-2 w-2 shrink-0 rounded-full"
              :style="`background: ${connected ? 'var(--ds-success)' : 'var(--ds-danger)'}`"
              :title="connected ? '已连接' : '模型未连接'"
            />
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button class="ds-icon-button border border-glass-border" title="记忆" disabled>
          <Bookmark :size="17" :stroke-width="1.5" />
        </button>
        <button class="ds-icon-button border border-glass-border" title="语音" disabled>
          <Mic :size="17" :stroke-width="1.5" />
        </button>
        <button class="ds-icon-button border border-glass-border" title="设置" @click="openHub">
          <Settings :size="17" :stroke-width="1.5" />
        </button>
        <button
          class="ds-icon-button border border-glass-border"
          title="关闭"
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
            {{ g.role === 'assistant' ? '小' : '你' }}
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
        <button class="ds-icon-button min-h-8 min-w-8" title="添加附件" disabled>
          <Paperclip :size="17" :stroke-width="1.5" />
        </button>
        <input
          v-model="draft"
          class="min-w-0 flex-1 bg-transparent px-1 text-base outline-none"
          placeholder="跟我说点什么吧..."
          :disabled="!ready"
          @keydown.enter="send"
        />
        <span class="shrink-0 font-mono text-xs text-text-sub">120 t</span>
        <button class="ds-icon-button min-h-8 min-w-8" title="语音输入" disabled>
          <Mic :size="17" :stroke-width="1.5" />
        </button>
        <button
          v-if="!streaming"
          class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition ease-ds active:scale-[0.97] disabled:opacity-50"
          style="background: linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to))"
          :disabled="!ready || !draft.trim()"
          title="发送"
          @click="send"
        >
          <Send :size="17" :stroke-width="1.5" />
        </button>
        <button
          v-else
          class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-glass-border text-text-sub"
          title="取消"
          @click="cancel"
        >
          <Square :size="15" :stroke-width="1.5" />
        </button>
      </div>
    </footer>
  </div>
</template>
