// UI Overlay renderer — subscribes to the chat.* notification track and renders
// the streaming text. It never sees behavior tags: ConversationCore has already
// stripped them out Main-side. Send/cancel drive the pipeline over rpc.

interface DesksoulApi {
  rpc: (method: string, params?: unknown) => Promise<unknown>;
  on: (channel: string, cb: (payload: unknown) => void) => () => void;
}

declare global {
  interface Window {
    desksoul: DesksoulApi;
  }
}

const SESSION_ID = 's4-demo';

const bubble = document.getElementById('bubble') as HTMLDivElement;
const status = document.getElementById('meta') as HTMLDivElement;
const sendBtn = document.getElementById('send') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancel') as HTMLButtonElement;

let streaming = false;

function setStreaming(on: boolean): void {
  streaming = on;
  sendBtn.disabled = on;
  cancelBtn.disabled = !on;
  status.textContent = on ? '● streaming…' : '○ idle';
}

window.desksoul.on('chat.stream', (payload) => {
  const { sessionId, text } = payload as { sessionId: string; text: string };
  if (sessionId !== SESSION_ID) return;
  bubble.textContent += text;
});

window.desksoul.on('chat.done', (payload) => {
  const { sessionId, finishReason } = payload as {
    sessionId: string;
    finishReason: 'stop' | 'cancel' | 'error';
  };
  if (sessionId !== SESSION_ID) return;
  setStreaming(false);
  status.textContent = `○ done (${finishReason})`;
});

sendBtn.addEventListener('click', async () => {
  if (streaming) return;
  bubble.textContent = '';
  setStreaming(true);
  try {
    await window.desksoul.rpc('chat.send', { sessionId: SESSION_ID, text: 'hello' });
  } catch (e) {
    setStreaming(false);
    status.textContent = `✗ ${(e as Error).message}`;
  }
});

cancelBtn.addEventListener('click', () => {
  if (!streaming) return;
  void window.desksoul.rpc('chat.cancel', { sessionId: SESSION_ID });
  status.textContent = '○ cancelling…';
});

setStreaming(false);

export {};
