<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { ChatView, type ChatMessage } from './chat-view';

const SESSION_ID = 'default';

const messages = ref<ChatMessage[]>([]);
const streaming = ref(false);
const ready = ref(false);
const draft = ref('你好呀');
const meta = ref('○ 连接中…');
const unsubs: Array<() => void> = [];

const view = new ChatView(SESSION_ID, () => {
  messages.value = view.messages.map((m) => ({ ...m }));
  streaming.value = view.streaming;
});

onMounted(async () => {
  // 先订阅后快照：竞态由 ChatView 的 seq 缓冲处理
  unsubs.push(
    window.desksoul.on('chat.stream', (p) => view.onStream(p)),
    window.desksoul.on('chat.done', (p) => {
      view.onDone(p);
      meta.value = `○ done (${p.finishReason})`;
    }),
  );
  try {
    const snap = await window.desksoul.rpc('chat.snapshot', { sessionId: SESSION_ID });
    view.applySnapshot(snap);
    ready.value = true;
    meta.value = view.streaming ? '● streaming…' : '○ idle';
  } catch (e) {
    meta.value = `✗ snapshot failed: ${(e as Error).message}`;
  }
});

onUnmounted(() => {
  for (const u of unsubs) u();
});

async function send(): Promise<void> {
  if (streaming.value || !ready.value || !draft.value) return;
  view.echoUser(draft.value);
  meta.value = '● streaming…';
  try {
    await window.desksoul.rpc('chat.send', { sessionId: SESSION_ID, text: draft.value });
    draft.value = '';
  } catch (e) {
    view.rollbackEcho();
    meta.value = `✗ ${(e as Error).message}`;
  }
}

function cancel(): void {
  if (!streaming.value) return;
  void window.desksoul.rpc('chat.cancel', { sessionId: SESSION_ID });
  meta.value = '○ cancelling…';
}

function openHub(): void {
  void window.desksoul.rpc('app.window.openHub', {});
}
</script>

<template>
  <div class="overlay">
    <div class="head">
      <h2>DeskSoul · 对话（M2）</h2>
      <button class="gear" title="设置 (Ctrl+Shift+,)" @click="openHub">⚙</button>
    </div>
    <div class="history">
      <div v-for="(m, i) in messages" :key="i" class="msg" :class="`msg-${m.role}`">
        <span class="text">{{ m.text }}</span>
        <span v-if="m.role === 'assistant' && m.finishReason === null && streaming" class="caret" />
        <span v-if="m.finishReason === 'cancel'" class="chip">已取消</span>
        <span v-else-if="m.finishReason === 'error'" class="chip chip-err">出错了</span>
      </div>
    </div>
    <div class="meta">{{ meta }}</div>
    <div class="row">
      <input v-model="draft" :disabled="streaming || !ready" @keydown.enter="send" />
      <button class="send" :disabled="streaming || !ready" @click="send">发送</button>
      <button :disabled="!streaming" @click="cancel">取消</button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 16px;
  gap: 12px;
  box-sizing: border-box;
  font-family: system-ui, sans-serif;
  background: #f6f7fb;
  color: #15151a;
}
h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #5b6472;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.gear {
  border: none;
  background: transparent;
  font-size: 16px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 8px;
}
.gear:hover {
  background: #eef1f7;
}
.history {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.msg {
  max-width: 86%;
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 15px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg-user {
  align-self: flex-end;
  background: #5b8def;
  color: #fff;
}
.msg-assistant {
  align-self: flex-start;
  background: #fff;
  border: 1px solid #e3e6ee;
}
.chip {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  background: #eef1f7;
  color: #8a93a3;
}
.chip-err {
  background: #fdecec;
  color: #c2504d;
}
.caret {
  display: inline-block;
  width: 7px;
  height: 1.1em;
  margin-left: 1px;
  vertical-align: text-bottom;
  background: #5b8def;
  animation: blink 1s steps(2) infinite;
}
@keyframes blink {
  0%,
  50% {
    opacity: 1;
  }
  50.01%,
  100% {
    opacity: 0;
  }
}
.meta {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: #8a93a3;
  min-height: 1.4em;
}
.row {
  display: flex;
  gap: 8px;
}
input {
  flex: 1;
  font-size: 14px;
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid #cdd3df;
}
button {
  font-size: 14px;
  padding: 9px 18px;
  border-radius: 8px;
  border: 1px solid #cdd3df;
  background: #fff;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
.send {
  background: #5b8def;
  border-color: #5b8def;
  color: #fff;
}
</style>
