import { parentPort } from 'node:worker_threads';

// 把收到的 chat.start 帧 base64 编码进 delta（前缀 'REQ:'）。
// base64 字母表不含 < 或 [，能安全穿过 ConversationCore 的 BehaviorParser 双轨拆分。
parentPort.on('message', (m) => {
  if (m.kind !== 'chat.start') return;
  const echo =
    'REQ:' +
    Buffer.from(
      JSON.stringify({ providerId: m.providerId ?? null, request: m.request ?? null }),
    ).toString('base64');
  parentPort.postMessage({
    kind: 'chat.event',
    requestId: m.requestId,
    sessionId: m.sessionId,
    event: { type: 'delta', text: echo },
  });
  parentPort.postMessage({
    kind: 'chat.event',
    requestId: m.requestId,
    sessionId: m.sessionId,
    event: { type: 'done', finishReason: 'stop' },
  });
});
