<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

const SESSION_ID = 'default';

const bubble = ref('');
const draft = ref('你好呀');
const streaming = ref(false);
const meta = ref('○ idle');
const unsubs: Array<() => void> = [];

onMounted(() => {
  unsubs.push(
    window.desksoul.on('chat.stream', (payload) => {
      const { sessionId, text } = payload as { sessionId: string; text: string };
      if (sessionId !== SESSION_ID) return;
      bubble.value += text;
    }),
    window.desksoul.on('chat.done', (payload) => {
      const { sessionId, finishReason } = payload as { sessionId: string; finishReason: string };
      if (sessionId !== SESSION_ID) return;
      streaming.value = false;
      meta.value = `○ done (${finishReason})`;
    }),
  );
});

onUnmounted(() => {
  for (const u of unsubs) u();
});

async function send(): Promise<void> {
  if (streaming.value) return;
  bubble.value = '';
  streaming.value = true;
  meta.value = '● streaming…';
  try {
    await window.desksoul.rpc('chat.send', { sessionId: SESSION_ID, text: draft.value });
  } catch (e) {
    streaming.value = false;
    meta.value = `✗ ${(e as Error).message}`;
  }
}

function cancel(): void {
  if (!streaming.value) return;
  void window.desksoul.rpc('chat.cancel', { sessionId: SESSION_ID });
  meta.value = '○ cancelling…';
}
</script>

<template>
  <div class="overlay">
    <h2>DeskSoul · 对话（M1 骨架）</h2>
    <div class="bubble">{{ bubble }}<span v-if="streaming" class="caret" /></div>
    <div class="meta">{{ meta }}</div>
    <div class="row">
      <input v-model="draft" :disabled="streaming" @keydown.enter="send" />
      <button class="send" :disabled="streaming" @click="send">发送</button>
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
.bubble {
  flex: 1;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #e3e6ee;
  border-radius: 12px;
  padding: 14px 16px;
  font-size: 15px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
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
