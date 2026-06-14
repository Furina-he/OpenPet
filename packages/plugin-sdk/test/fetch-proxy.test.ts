import { describe, it, expect, afterEach } from 'vitest';
import { MessageChannel } from 'node:worker_threads';
import { installFetchProxy, __resetFetchProxyForTest } from '../src/fetch-proxy.js';

afterEach(() => __resetFetchProxyForTest());

describe('installFetchProxy (streaming)', () => {
  it('sends a fetchRequest frame carrying method/headers/body', async () => {
    const { port1, port2 } = new MessageChannel();
    installFetchProxy(port1);
    const reqP = new Promise<any>((resolve) => port2.once('message', resolve));
    void fetch('https://api.example.com/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"test":true}',
    });
    const req = await reqP;
    expect(req.kind).toBe('plugin.fetchRequest');
    expect(req.url).toBe('https://api.example.com/test');
    expect(req.init.method).toBe('POST');
    expect(req.init.headers['content-type']).toBe('application/json');
    expect(req.init.body).toBe('{"test":true}');
    port1.close();
    port2.close();
  });

  it('streams chunks as a ReadableStream body', async () => {
    const { port1, port2 } = new MessageChannel();
    installFetchProxy(port1);
    port2.on('message', (m: any) => {
      if (m.kind !== 'plugin.fetchRequest') return;
      port2.postMessage({
        kind: 'plugin.fetchChunk',
        id: m.id,
        phase: 'head',
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
      port2.postMessage({ kind: 'plugin.fetchChunk', id: m.id, phase: 'data', chunk: 'hello ' });
      port2.postMessage({ kind: 'plugin.fetchChunk', id: m.id, phase: 'data', chunk: 'world' });
      port2.postMessage({ kind: 'plugin.fetchChunk', id: m.id, phase: 'end' });
    });
    const res = await fetch('https://x/y', { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello world');
    port1.close();
    port2.close();
  });

  it('rejects when an error arrives before head', async () => {
    const { port1, port2 } = new MessageChannel();
    installFetchProxy(port1);
    port2.on('message', (m: any) => {
      if (m.kind !== 'plugin.fetchRequest') return;
      port2.postMessage({ kind: 'plugin.fetchChunk', id: m.id, phase: 'error', error: 'net down' });
    });
    await expect(fetch('https://x/y')).rejects.toThrow(/net down/);
    port1.close();
    port2.close();
  });
});
