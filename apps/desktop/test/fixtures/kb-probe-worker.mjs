import { parentPort } from 'node:worker_threads';

// §5 测试用 worker：探针 system prompt 是否含 RAG 片段标记，但回复保持干净。
// emit 'SAW_SNIPPET'/'NO_SNIPPET'（不回吐原片段）→ 既验证注入到 system，又钉死片段不进 chat.stream。
const MARKER = 'KBSNIPPET_MARKER';
parentPort.on('message', (m) => {
  if (m.kind !== 'chat.start') return;
  const { requestId, sessionId } = m;
  const system = m.request?.messages?.[0]?.content ?? '';
  const saw = system.includes(MARKER) ? 'SAW_SNIPPET' : 'NO_SNIPPET';
  parentPort.postMessage({
    kind: 'chat.event',
    requestId,
    sessionId,
    event: { type: 'delta', text: saw },
  });
  parentPort.postMessage({
    kind: 'chat.event',
    requestId,
    sessionId,
    event: { type: 'done', finishReason: 'stop' },
  });
});
