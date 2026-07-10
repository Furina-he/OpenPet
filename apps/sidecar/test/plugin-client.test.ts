import { describe, it, expect } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import { createPluginClient } from '../src/plugin-client.js';
import type { PluginResponseFrame } from '@openpet/protocol';

describe('PluginClient', () => {
  it('resolves a result response correlated by id', async () => {
    const { port1, port2 } = new MessageChannel();
    const client = createPluginClient(port1);

    const promise = client.call('plugin.list', undefined);

    port2.once('message', (msg) => {
      const response: PluginResponseFrame = {
        kind: 'plugin.response',
        rpc: { jsonrpc: '2.0', id: msg.rpc.id, result: { plugins: [] } },
      };
      port2.postMessage(response);
    });

    const result = await promise;
    expect(result).toEqual({ plugins: [] });

    port1.close();
    port2.close();
  });

  it('rejects an error response with the code attached', async () => {
    const { port1, port2 } = new MessageChannel();
    const client = createPluginClient(port1);

    const promise = client.call('plugin.enable', { id: 'foo' });

    port2.once('message', (msg) => {
      const response: PluginResponseFrame = {
        kind: 'plugin.response',
        rpc: { jsonrpc: '2.0', id: msg.rpc.id, error: { code: -32001, message: 'Not found' } },
      };
      port2.postMessage(response);
    });

    await expect(promise).rejects.toThrowError('Not found');
    await expect(promise).rejects.toMatchObject({ code: -32001 });

    port1.close();
    port2.close();
  });

  it('correlates concurrent requests even when responses come back out of order', async () => {
    const { port1, port2 } = new MessageChannel();
    const client = createPluginClient(port1);

    const requests: any[] = [];
    port2.on('message', (msg) => {
      requests.push(msg);
    });

    const p1 = client.call('plugin.list', undefined);
    const p2 = client.call('plugin.enable', { id: 'foo' });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const id1 = requests[0].rpc.id;
    const id2 = requests[1].rpc.id;

    port2.postMessage({
      kind: 'plugin.response',
      rpc: { jsonrpc: '2.0', id: id2, result: { success: true } },
    } satisfies PluginResponseFrame);

    port2.postMessage({
      kind: 'plugin.response',
      rpc: { jsonrpc: '2.0', id: id1, result: { plugins: ['a'] } },
    } satisfies PluginResponseFrame);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ plugins: ['a'] });
    expect(r2).toEqual({ success: true });

    port1.close();
    port2.close();
  });

  it('ignores non-plugin frames on the same port (chat.* coexistence)', async () => {
    const { port1, port2 } = new MessageChannel();
    const client = createPluginClient(port1);

    const promise = client.call('plugin.list', undefined);

    port2.once('message', (msg) => {
      port2.postMessage({
        kind: 'chat.event',
        requestId: 'r1',
        sessionId: 's1',
        event: { type: 'delta', text: 'hello' },
      });

      port2.postMessage({
        kind: 'plugin.response',
        rpc: { jsonrpc: '2.0', id: msg.rpc.id, result: { plugins: [] } },
      } satisfies PluginResponseFrame);
    });

    const result = await promise;
    expect(result).toEqual({ plugins: [] });

    port1.close();
    port2.close();
  });
});
