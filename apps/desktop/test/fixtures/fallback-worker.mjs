import { parentPort } from 'node:worker_threads';

// providerId 'bad' → 立即 error done（无 delta）；其他 → delta 'ok' + stop。
parentPort.on('message', (m) => {
  if (m.kind !== 'chat.start') return;
  const { requestId, sessionId } = m;
  if (m.providerId === 'bad') {
    parentPort.postMessage({
      kind: 'chat.event',
      requestId,
      sessionId,
      event: { type: 'done', finishReason: 'error', error: 'bad provider', errorKind: 'server' },
    });
  } else {
    parentPort.postMessage({
      kind: 'chat.event',
      requestId,
      sessionId,
      event: { type: 'delta', text: 'ok' },
    });
    parentPort.postMessage({
      kind: 'chat.event',
      requestId,
      sessionId,
      event: { type: 'done', finishReason: 'stop' },
    });
  }
});
