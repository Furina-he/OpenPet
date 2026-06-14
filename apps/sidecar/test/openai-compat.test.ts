import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ChatEvent } from '@desksoul/protocol';
import { getDialect } from '@desksoul/protocol';
import { openaiCompatChat } from '../src/workers/providers/openai-compat.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function sseResponse(lines: string[], status = 200): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
  return new Response(status === 200 ? body : null, { status });
}

async function collect(it: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const dialect = getDialect('openai')!;
const req = { messages: [{ role: 'user' as const, content: 'hi' }] };

describe('openaiCompatChat', () => {
  it('maps content deltas + usage then a stop done', async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" there"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
        'data: [DONE]\n\n',
      ]),
    ) as typeof fetch;
    const ev = await collect(openaiCompatChat(dialect, req, new AbortController().signal));
    expect(
      ev
        .filter((e) => e.type === 'delta')
        .map((e) => (e as { text: string }).text)
        .join(''),
    ).toBe('Hi there');
    expect(ev.find((e) => e.type === 'usage')).toMatchObject({ prompt: 3, completion: 2 });
    expect(ev.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('classifies a 401 as auth error done', async () => {
    globalThis.fetch = vi.fn(async () => sseResponse([], 401)) as typeof fetch;
    const ev = await collect(openaiCompatChat(dialect, req, new AbortController().signal));
    expect(ev.at(-1)).toMatchObject({ type: 'done', finishReason: 'error', errorKind: 'auth' });
  });

  it('classifies a thrown network failure', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const ev = await collect(openaiCompatChat(dialect, req, new AbortController().signal));
    expect(ev.at(-1)).toMatchObject({ type: 'done', finishReason: 'error', errorKind: 'network' });
  });

  it('ends with cancel when signal already aborted mid-stream', async () => {
    const ac = new AbortController();
    globalThis.fetch = vi.fn(async () => {
      ac.abort();
      return sseResponse(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n', 'data: [DONE]\n\n']);
    }) as typeof fetch;
    const ev = await collect(openaiCompatChat(dialect, req, ac.signal));
    expect(ev.at(-1)).toEqual({ type: 'done', finishReason: 'cancel' });
  });

  it('falls back to estimated usage when provider omits it', async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"hello world"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    ) as typeof fetch;
    const ev = await collect(openaiCompatChat(dialect, req, new AbortController().signal));
    const usage = ev.find((e) => e.type === 'usage') as
      | { prompt: number; completion: number }
      | undefined;
    expect(usage).toBeDefined();
    expect(usage!.completion).toBeGreaterThan(0);
    expect(usage!.prompt).toBeGreaterThan(0);
  });

  it('aggregates streamed tool_calls into a tool_call event', async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"search","arguments":"{\\"q\\":"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"cats\\"}"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    ) as typeof fetch;
    const ev = await collect(openaiCompatChat(dialect, req, new AbortController().signal));
    const tc = ev.find((e) => e.type === 'tool_call') as
      | { id: string; name: string; args: { q: string } }
      | undefined;
    expect(tc).toMatchObject({ id: 'c1', name: 'search' });
    expect(tc!.args).toEqual({ q: 'cats' });
    expect(ev.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });
});
