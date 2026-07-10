import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ChatEvent } from '@openpet/protocol';
import { getDialect } from '@openpet/protocol';
import { ollamaChat, toOllamaMessages } from '../src/workers/providers/ollama.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function ndjson(lines: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}

async function collect(it: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const o: ChatEvent[] = [];
  for await (const e of it) o.push(e);
  return o;
}

describe('ollamaChat', () => {
  it('maps NDJSON message chunks to deltas + usage + stop', async () => {
    globalThis.fetch = vi.fn(async () =>
      ndjson([
        '{"message":{"content":"你"},"done":false}\n',
        '{"message":{"content":"好"},"done":false}\n',
        '{"done":true,"prompt_eval_count":7,"eval_count":2}\n',
      ]),
    ) as typeof fetch;
    const ev = await collect(
      ollamaChat(
        getDialect('ollama')!,
        { messages: [{ role: 'user', content: 'hi' }], model: 'llama3' },
        new AbortController().signal,
      ),
    );
    expect(
      ev
        .filter((e) => e.type === 'delta')
        .map((e) => (e as { text: string }).text)
        .join(''),
    ).toBe('你好');
    expect(ev.find((e) => e.type === 'usage')).toMatchObject({ prompt: 7, completion: 2 });
    expect(ev.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('handles a chunk split across read boundaries', async () => {
    globalThis.fetch = vi.fn(async () =>
      ndjson(['{"message":{"content":"a"},', '"done":false}\n{"done":true}\n']),
    ) as typeof fetch;
    const ev = await collect(
      ollamaChat(getDialect('ollama')!, { messages: [] }, new AbortController().signal),
    );
    expect(ev.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text)).toEqual([
      'a',
    ]);
  });
});

it('toOllamaMessages：剥离中立字段 + 丢空 assistant，tool role 原样', () => {
  expect(
    toOllamaMessages([
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 't', argsJson: '{}' }] },
      { role: 'tool', content: 'r', toolCallId: 'c1' },
      { role: 'user', content: 'hi' },
    ]),
  ).toEqual([
    { role: 'tool', content: 'r' },
    { role: 'user', content: 'hi' },
  ]);
});
