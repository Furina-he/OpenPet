import { describe, it, expect } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import { attachServer } from '../src/worker-entry';

describe('attachServer (MessagePort round-trip)', () => {
  it('handles sys.ping over a real MessagePort', async () => {
    const { port1, port2 } = new MessageChannel();
    attachServer(port1);

    const response = new Promise((resolve) => {
      port2.once('message', resolve);
    });
    port2.postMessage({ jsonrpc: '2.0', id: 7, method: 'sys.ping', params: { nonce: 'z' } });

    expect(await response).toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: { pong: 'ok', echoNonce: 'z' },
    });
    port1.close();
    port2.close();
  });

  it('returns parse error -32700 for malformed frames', async () => {
    const { port1, port2 } = new MessageChannel();
    attachServer(port1);

    const response = new Promise((resolve) => {
      port2.once('message', resolve);
    });
    // a value that JSON.stringify -> parseRequest cannot validate as a request
    port2.postMessage({ not: 'a jsonrpc request' });

    const out = (await response) as { error: { code: number }; id: unknown };
    expect(out.error.code).toBe(-32700);
    expect(out.id).toBe(null);
    port1.close();
    port2.close();
  });
});
