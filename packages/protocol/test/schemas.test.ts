import { describe, it, expect } from 'vitest';
import {
  ChatEventSchema,
  ChatStartFrame,
  ChatCancelFrame,
  ChatEventFrame,
  ProviderInboundFrame,
  PluginRequestFrame,
  PluginResponseFrame,
  PluginFetchRequestFrame,
  PluginFetchChunkFrame,
  ChatRequestSchema,
  ProviderOutboundFrame,
} from '../src/schemas';

describe('worker frame schemas', () => {
  it('parses a delta chat event', () => {
    const e = ChatEventSchema.parse({ type: 'delta', text: '嗯…' });
    expect(e).toEqual({ type: 'delta', text: '嗯…' });
  });

  it('parses done with all three finish reasons', () => {
    for (const finishReason of ['stop', 'cancel', 'error'] as const) {
      expect(ChatEventSchema.parse({ type: 'done', finishReason })).toEqual({
        type: 'done',
        finishReason,
      });
    }
  });

  it('rejects an unknown finishReason', () => {
    expect(() => ChatEventSchema.parse({ type: 'done', finishReason: 'oops' })).toThrow();
  });

  it('parses chat.start with optional intervalMs', () => {
    expect(ChatStartFrame.parse({ kind: 'chat.start', requestId: 'r1', sessionId: 's1' })).toEqual({
      kind: 'chat.start',
      requestId: 'r1',
      sessionId: 's1',
    });
    expect(
      ChatStartFrame.parse({ kind: 'chat.start', requestId: 'r1', sessionId: 's1', intervalMs: 0 }),
    ).toMatchObject({ intervalMs: 0 });
  });

  it('parses chat.cancel', () => {
    expect(ChatCancelFrame.parse({ kind: 'chat.cancel', requestId: 'r1' })).toEqual({
      kind: 'chat.cancel',
      requestId: 'r1',
    });
  });

  it('parses chat.event envelope', () => {
    const frame = ChatEventFrame.parse({
      kind: 'chat.event',
      requestId: 'r1',
      sessionId: 's1',
      event: { type: 'delta', text: 'x' },
    });
    expect(frame.event).toEqual({ type: 'delta', text: 'x' });
  });

  it('discriminates inbound frames by kind', () => {
    expect(ProviderInboundFrame.parse({ kind: 'chat.cancel', requestId: 'r9' })).toMatchObject({
      kind: 'chat.cancel',
    });
    expect(() => ProviderInboundFrame.parse({ kind: 'nope' })).toThrow();
  });
});

describe('plugin frames (M2)', () => {
  it('parses a plugin.request with numeric id', () => {
    const f = PluginRequestFrame.parse({
      kind: 'plugin.request',
      rpc: { jsonrpc: '2.0', id: 1, method: 'plugin.registerSkill', params: { skillId: 's' } },
    });
    expect(f.rpc.method).toBe('plugin.registerSkill');
  });

  it('rejects a plugin.request with string/null id (must be correlatable number)', () => {
    expect(() =>
      PluginRequestFrame.parse({
        kind: 'plugin.request',
        rpc: { jsonrpc: '2.0', id: null, method: 'x' },
      }),
    ).toThrow();
    expect(() =>
      PluginRequestFrame.parse({
        kind: 'plugin.request',
        rpc: { jsonrpc: '2.0', id: 'a', method: 'x' },
      }),
    ).toThrow();
  });

  it('parses a plugin.response carrying result or error', () => {
    expect(
      PluginResponseFrame.parse({
        kind: 'plugin.response',
        rpc: { jsonrpc: '2.0', id: 1, result: { ok: true } },
      }).rpc.result,
    ).toEqual({ ok: true });
    expect(
      PluginResponseFrame.parse({
        kind: 'plugin.response',
        rpc: { jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'no' } },
      }).rpc.error?.code,
    ).toBe(-32601);
  });

  it('outbound union discriminates chat.event vs plugin.request', () => {
    expect(
      ProviderOutboundFrame.parse({
        kind: 'chat.event',
        requestId: 'r1',
        sessionId: 's1',
        event: { type: 'delta', text: 'x' },
      }).kind,
    ).toBe('chat.event');
    expect(
      ProviderOutboundFrame.parse({
        kind: 'plugin.request',
        rpc: { jsonrpc: '2.0', id: 1, method: 'plugin.invokeTool' },
      }).kind,
    ).toBe('plugin.request');
  });

  it('inbound union accepts plugin.response', () => {
    expect(
      ProviderInboundFrame.parse({
        kind: 'plugin.response',
        rpc: { jsonrpc: '2.0', id: 1, result: null },
      }).kind,
    ).toBe('plugin.response');
  });
});

describe('ChatEventSchema · M5 extensions (usage / tool_call / done.error)', () => {
  it('accepts a usage event', () => {
    expect(ChatEventSchema.safeParse({ type: 'usage', prompt: 10, completion: 5 }).success).toBe(true);
  });
  it('accepts a tool_call event', () => {
    expect(
      ChatEventSchema.safeParse({ type: 'tool_call', id: 'c1', name: 'search', args: { q: 'x' } })
        .success,
    ).toBe(true);
  });
  it('accepts done with error + errorKind', () => {
    expect(
      ChatEventSchema.safeParse({
        type: 'done',
        finishReason: 'error',
        error: 'boom',
        errorKind: 'auth',
      }).success,
    ).toBe(true);
  });
});

describe('fetch frames (M5)', () => {
  it('parses a fetchRequest frame', () => {
    expect(
      PluginFetchRequestFrame.safeParse({
        kind: 'plugin.fetchRequest',
        id: 'f1',
        url: 'https://api.openai.com/v1/chat/completions',
        init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      }).success,
    ).toBe(true);
  });
  it('parses fetchChunk head/data/end/error frames', () => {
    expect(
      PluginFetchChunkFrame.safeParse({
        kind: 'plugin.fetchChunk',
        id: 'f1',
        phase: 'head',
        status: 200,
        headers: {},
      }).success,
    ).toBe(true);
    expect(
      PluginFetchChunkFrame.safeParse({
        kind: 'plugin.fetchChunk',
        id: 'f1',
        phase: 'data',
        chunk: 'abc',
      }).success,
    ).toBe(true);
    expect(
      PluginFetchChunkFrame.safeParse({ kind: 'plugin.fetchChunk', id: 'f1', phase: 'end' }).success,
    ).toBe(true);
    expect(
      PluginFetchChunkFrame.safeParse({
        kind: 'plugin.fetchChunk',
        id: 'f1',
        phase: 'error',
        error: 'x',
      }).success,
    ).toBe(true);
  });
  it('outbound union includes fetchRequest; inbound includes fetchChunk', () => {
    expect(
      ProviderOutboundFrame.safeParse({
        kind: 'plugin.fetchRequest',
        id: 'f1',
        url: 'u',
        init: { method: 'GET' },
      }).success,
    ).toBe(true);
    expect(
      ProviderInboundFrame.safeParse({ kind: 'plugin.fetchChunk', id: 'f1', phase: 'end' }).success,
    ).toBe(true);
  });
});

describe('ChatRequest / ChatStartFrame (M5)', () => {
  const req = {
    messages: [{ role: 'user', content: 'hi' }],
    model: 'gpt-4o-mini',
    params: { temperature: 0.7, maxTokens: 256 },
  };
  it('parses a ChatRequest', () => {
    expect(ChatRequestSchema.safeParse(req).success).toBe(true);
  });
  it('chat.start carries providerId + request, and still accepts mock intervalMs', () => {
    expect(
      ChatStartFrame.safeParse({
        kind: 'chat.start',
        requestId: 'r1',
        sessionId: 's1',
        providerId: 'openai',
        request: req,
      }).success,
    ).toBe(true);
    expect(
      ChatStartFrame.safeParse({ kind: 'chat.start', requestId: 'r1', sessionId: 's1', intervalMs: 0 })
        .success,
    ).toBe(true);
  });
});
