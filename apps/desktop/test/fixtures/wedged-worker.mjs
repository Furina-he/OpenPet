// Wedged-provider fixture：开始流后只发一个 delta，然后永远沉默，无视 chat.cancel。
// 用于逼出 ProviderHost 的 cancel watchdog 强杀路径。
import { parentPort } from 'node:worker_threads';

if (!parentPort) throw new Error('must run in worker_threads');

parentPort.on('message', (msg) => {
  if (msg.kind === 'chat.start') {
    parentPort.postMessage({
      kind: 'chat.event',
      requestId: msg.requestId,
      sessionId: msg.sessionId,
      event: { type: 'delta', text: 'wedged…' },
    });
  }
  // deliberately ignore chat.cancel
});
