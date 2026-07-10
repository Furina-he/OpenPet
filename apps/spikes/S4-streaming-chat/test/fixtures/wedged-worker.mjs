// Fixture worker for ProviderHost cancel-watchdog test: starts a stream but
// NEVER honors cancel and never sends `done`. This wedged-provider stand-in
// forces the host's 200ms watchdog to terminate it and synthesize a cancel.
import { parentPort } from 'node:worker_threads';

if (!parentPort) throw new Error('must run in worker_threads');

parentPort.on('message', (msg) => {
  if (msg.kind === 'chat.start') {
    // emit one delta so the stream is visibly "live", then go silent forever
    parentPort.postMessage({
      kind: 'chat.event',
      requestId: msg.requestId,
      sessionId: msg.sessionId,
      event: { type: 'delta', text: 'wedged…' },
    });
  }
  // deliberately ignore chat.cancel
});
