import { parentPort } from 'node:worker_threads';

const pending = new Map();

parentPort.on('message', async (msg) => {
  if (msg.kind === 'plugin.fetchChunk') {
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.phase === 'head') p.parts.push(`H${msg.status}`);
    else if (msg.phase === 'data') p.parts.push(msg.chunk);
    else if (msg.phase === 'end') {
      p.resolve(p.parts.join(''));
      pending.delete(msg.id);
    } else if (msg.phase === 'error') {
      p.resolve(`ERR:${msg.error}`);
      pending.delete(msg.id);
    }
    return;
  }
  if (msg.kind === 'chat.start') {
    const id = 'fx1';
    const body = await new Promise((resolve) => {
      pending.set(id, { parts: [], resolve });
      parentPort.postMessage({
        kind: 'plugin.fetchRequest',
        id,
        url: 'https://api.openai.com/probe',
        init: { method: 'GET' },
      });
    });
    parentPort.postMessage({
      kind: 'chat.event',
      requestId: msg.requestId,
      sessionId: msg.sessionId,
      event: { type: 'delta', text: body },
    });
    parentPort.postMessage({
      kind: 'chat.event',
      requestId: msg.requestId,
      sessionId: msg.sessionId,
      event: { type: 'done', finishReason: 'stop' },
    });
  }
});
