import { describe, it, expect } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import { attachProviderServer, type EventMessage } from '../src/workers/provider-worker-entry';

/** Collects `chat.event` frames until a terminal `done`, then resolves. */
function collectStream(port: import('node:worker_threads').MessagePort): Promise<EventMessage[]> {
  return new Promise((resolve) => {
    const events: EventMessage[] = [];
    port.on('message', (msg: EventMessage) => {
      events.push(msg);
      if (msg.event.type === 'done') resolve(events);
    });
  });
}

describe('attachProviderServer (streaming MessagePort)', () => {
  it('streams scripted deltas then a stop done for a chat.start', async () => {
    const { port1, port2 } = new MessageChannel();
    attachProviderServer(port1);
    const done = collectStream(port2);

    port2.postMessage({
      kind: 'chat.start',
      requestId: 'r1',
      sessionId: 's1',
      intervalMs: 0,
    });

    const events = await done;
    expect(events.every((e) => e.requestId === 'r1' && e.sessionId === 's1')).toBe(true);
    expect(events.at(-1)!.event).toEqual({ type: 'done', finishReason: 'stop' });
    const deltas = events.filter((e) => e.event.type === 'delta');
    expect(deltas.length).toBeGreaterThan(0);

    port1.close();
    port2.close();
  });

  it('ends a stream early with cancel when chat.cancel arrives', async () => {
    const { port1, port2 } = new MessageChannel();
    attachProviderServer(port1);

    const events: EventMessage[] = [];
    const done = new Promise<void>((resolve) => {
      port2.on('message', (msg: EventMessage) => {
        events.push(msg);
        if (msg.event.type === 'delta' && events.length === 1) {
          // cancel right after the first delta
          port2.postMessage({ kind: 'chat.cancel', requestId: 'r2' });
        }
        if (msg.event.type === 'done') resolve();
      });
    });

    port2.postMessage({
      kind: 'chat.start',
      requestId: 'r2',
      sessionId: 's2',
      intervalMs: 10,
    });

    await done;
    expect(events.at(-1)!.event).toEqual({ type: 'done', finishReason: 'cancel' });

    port1.close();
    port2.close();
  });
});
