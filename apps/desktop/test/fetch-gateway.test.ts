import { describe, it, expect, vi } from 'vitest';
import type { PluginFetchChunkFrame, PluginFetchRequestFrame } from '@openpet/protocol';
import { createFetchGateway, type HttpAgent } from '../electron/main/fetch-gateway';

const reqFrame = (over: Partial<PluginFetchRequestFrame> = {}): PluginFetchRequestFrame => ({
  kind: 'plugin.fetchRequest',
  id: 'f1',
  url: 'https://api.openai.com/v1/chat/completions',
  init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
  ...over,
});

describe('FetchGateway', () => {
  it('rejects a host not on the whitelist with an error chunk', async () => {
    const sent: PluginFetchChunkFrame[] = [];
    const agent: HttpAgent = vi.fn();
    const gw = createFetchGateway({
      agent,
      resolveHost: () => null,
      injectAuth: async (_id, _url, h) => ({ headers: h }),
    });
    gw.handle(reqFrame({ url: 'https://evil.example/x' }), (c) => sent.push(c));
    await Promise.resolve();
    expect(agent).not.toHaveBeenCalled();
    expect(sent).toEqual([
      {
        kind: 'plugin.fetchChunk',
        id: 'f1',
        phase: 'error',
        error: expect.stringContaining('not allowed'),
      },
    ]);
  });

  it('injects auth then streams head/data/end through chunk frames', async () => {
    const sent: PluginFetchChunkFrame[] = [];
    const agent: HttpAgent = (spec, sink) => {
      expect(spec.headers.authorization).toBe('Bearer sk-test');
      sink.head(200, { 'content-type': 'text/event-stream' });
      sink.data('data: a\n\n');
      sink.end();
    };
    const gw = createFetchGateway({
      agent,
      resolveHost: (url) => (url.includes('openai.com') ? { providerId: 'openai' } : null),
      injectAuth: async (id, _url, h) => ({
        headers: { ...h, authorization: id === 'openai' ? 'Bearer sk-test' : '' },
      }),
    });
    gw.handle(reqFrame(), (c) => sent.push(c));
    await new Promise((r) => setTimeout(r, 10));
    expect(sent.map((c) => c.phase)).toEqual(['head', 'data', 'end']);
    expect(sent[0]).toMatchObject({ phase: 'head', status: 200 });
    expect(sent[1]).toMatchObject({ phase: 'data', chunk: 'data: a\n\n' });
  });

  it('cancel(id) aborts the in-flight request signal', async () => {
    let aborted = false;
    const agent: HttpAgent = (spec) => {
      spec.signal.addEventListener('abort', () => (aborted = true));
    };
    const gw = createFetchGateway({
      agent,
      resolveHost: () => ({ providerId: 'openai' }),
      injectAuth: async (_i, _url, h) => ({ headers: h }),
    });
    gw.handle(reqFrame(), () => {});
    await new Promise((r) => setTimeout(r, 10));
    gw.cancel('f1');
    expect(aborted).toBe(true);
  });

  it('applies url rewrite from injectAuth (gemini query-key)', async () => {
    let calledUrl = '';
    const agent: HttpAgent = (spec, sink) => {
      calledUrl = spec.url;
      sink.head(200, {});
      sink.end();
    };
    const gw = createFetchGateway({
      agent,
      resolveHost: () => ({ providerId: 'gemini' }),
      injectAuth: async (_id, url, h) => ({ url: url + '?key=K', headers: h }),
    });
    gw.handle(reqFrame({ url: 'https://generativelanguage.googleapis.com/x' }), () => {});
    await new Promise((r) => setTimeout(r, 10));
    expect(calledUrl).toBe('https://generativelanguage.googleapis.com/x?key=K');
  });
});
