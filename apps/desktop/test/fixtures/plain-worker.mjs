// Plain-provider fixture：⑬ 表情兜底正例——纯文本流（零行为标签）+ done(stop)。
import { parentPort } from 'node:worker_threads';

if (!parentPort) throw new Error('must run in worker_threads');

parentPort.on('message', (msg) => {
  if (msg.kind === 'chat.start') {
    const send = (event) =>
      parentPort.postMessage({
        kind: 'chat.event',
        requestId: msg.requestId,
        sessionId: msg.sessionId,
        event,
      });
    send({ type: 'delta', text: '今天也要' });
    send({ type: 'delta', text: '加油哦。' });
    send({ type: 'done', finishReason: 'stop' });
  }
});
