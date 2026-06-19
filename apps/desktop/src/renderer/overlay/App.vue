<!-- apps/desktop/src/renderer/overlay/App.vue — B1 聊天浮层（ui-design §6.1；视觉 UI/60ea4a18 B1 区）
     复用 chat-view 会话模型；玻璃 + 顶栏（角色名/模型/连接态/⚙）+ 头像气泡列表 + 输入行。
     ?fixture=chat：注入假快照做视觉 harness（不连 Main）。 -->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { ChatView } from './chat-view';
import type { ChatMessage } from './chat-view';
import { groupMessages } from './bubble-view';
import Bubble from './components/Bubble.vue';

const SESSION_ID = 'default';
const messages = ref<ChatMessage[]>([]);
const streaming = ref(false);
const ready = ref(false);
const draft = ref('');
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
function avatar(role: ChatMessage['role']): string {
  return role === 'assistant' ? '🐧' : '🙂';
}
</script>

<template>
  <div class="ds-glass flex h-screen flex-col text-base text-text-main">
    <!-- 顶栏：角色名 + 模型 + 连接态 + 设置 -->
    <header class="flex items-center justify-between border-b border-glass-border px-4 py-3">
      <div class="flex items-center gap-2">
        <span class="text-md">{{ charName }}</span>
        <span class="text-sm text-text-sub">{{ modelLabel }}</span>
        <span
          class="h-2 w-2 rounded-full"
          :style="`background: ${connected ? 'var(--ds-success)' : 'var(--ds-danger)'}`"
          :title="connected ? '已连接' : '模型未连接'"
        />
      </div>
      <button
        class="rounded-btn px-2 py-1 text-text-sub hover:text-text-main"
        title="设置"
        @click="openHub"
      >
        ⚙
      </button>
    </header>

    <!-- 消息列表：按 role 分组，组内共享头像 -->
    <main class="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div
        v-for="(g, gi) in groupMessages(messages)"
        :key="gi"
        class="flex items-start gap-2"
        :class="g.role === 'user' ? 'flex-row-reverse' : ''"
      >
        <div
          class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg"
          style="background: var(--ds-glass-border)"
        >
          {{ avatar(g.role) }}
        </div>
        <div
          class="flex min-w-0 flex-1 flex-col gap-1"
          :class="g.role === 'user' ? 'items-end' : 'items-start'"
        >
          <Bubble v-for="(m, mi) in g.messages" :key="mi" :message="m" :streaming="streaming" />
        </div>
      </div>
    </main>

    <!-- 输入行 -->
    <footer class="flex items-center gap-2 border-t border-glass-border p-3">
      <input
        v-model="draft"
        class="flex-1 rounded-input border border-glass-border bg-transparent px-3 py-2 text-base outline-none"
        placeholder="和小灵说点什么…"
        :disabled="!ready"
        @keydown.enter="send"
      />
      <button
        v-if="!streaming"
        class="rounded-btn px-4 py-2 text-base text-white disabled:opacity-50"
        style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
        :disabled="!ready || !draft.trim()"
        @click="send"
      >
        发送
      </button>
      <button
        v-else
        class="rounded-btn border border-glass-border px-4 py-2 text-base text-text-sub"
        @click="cancel"
      >
        取消
      </button>
    </footer>
  </div>
</template>
