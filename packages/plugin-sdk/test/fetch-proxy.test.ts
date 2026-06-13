import { describe, it, expect, vi } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import { installFetchProxy } from '../src/fetch-proxy.js';

describe('fetch proxy', () => {
  it('sends fetch request to Main via MessagePort', async () => {
    const { port1, port2 } = new MessageChannel();
    const originalFetch = globalThis.fetch;

    installFetchProxy(port1);

    const responsePromise = fetch('https://api.example.com/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"test":true}',
    });

    // Main 侧模拟
    const reqMsg = await new Promise<any>((resolve) => {
      port2.once('message', resolve);
    });

    expect(reqMsg.kind).toBe('plugin.fetchRequest');
    expect(reqMsg.url).toBe('https://api.example.com/test');
    expect(reqMsg.init.method).toBe('POST');

    port2.postMessage({
      kind: 'plugin.fetchResponse',
      id: reqMsg.id,
      ok: true,
      status: 200,
      body: '{"result":"ok"}',
    });

    const response = await responsePromise;
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ result: 'ok' });

    globalThis.fetch = originalFetch;
  });
});
