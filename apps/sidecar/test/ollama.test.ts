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

  it('req.tools → 请求体 tools（openai 形状）；无 tools 不带字段', async () => {
    const fetchMock = vi.fn(async () => ndjson(['{"done":true}\n']));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await collect(
      ollamaChat(
        getDialect('ollama')!,
        {
          messages: [{ role: 'user', content: 'hi' }],
          tools: [{ name: 'search', description: '搜索', parameters: { type: 'object' } }],
        },
        new AbortController().signal,
      ),
    );
    const body1 = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body1.tools).toEqual([
      {
        type: 'function',
        function: { name: 'search', description: '搜索', parameters: { type: 'object' } },
      },
    ]);

    await collect(
      ollamaChat(
        getDialect('ollama')!,
        { messages: [{ role: 'user', content: 'hi' }] },
        new AbortController().signal,
      ),
    );
    const body2 = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    expect(body2).not.toHaveProperty('tools');
  });

  it('NDJSON message.tool_calls → tool_call 事件（id 缺省合成）', async () => {
    globalThis.fetch = vi.fn(async () =>
      ndjson([
        '{"message":{"content":"查一下"},"done":false}\n',
        '{"message":{"content":"","tool_calls":[{"function":{"name":"search","arguments":{"q":"cats"}}}]},"done":false}\n',
        '{"done":true,"prompt_eval_count":5,"eval_count":3}\n',
      ]),
    ) as typeof fetch;
    const ev = await collect(
      ollamaChat(
        getDialect('ollama')!,
        { messages: [{ role: 'user', content: 'hi' }] },
        new AbortController().signal,
      ),
    );
    expect(ev).toContainEqual({ type: 'delta', text: '查一下' });
    expect(ev.filter((e) => e.type === 'tool_call')).toEqual([
      { type: 'tool_call', id: 'call_search_0', name: 'search', args: { q: 'cats' } },
    ]);
    expect(ev.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('模型不支持 tools 的 400 → 既有 error done 链路（回归）', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 400 }),
    ) as unknown as typeof fetch;
    const ev = await collect(
      ollamaChat(
        getDialect('ollama')!,
        { messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 't' }] },
        new AbortController().signal,
      ),
    );
    expect(ev.at(-1)).toMatchObject({ type: 'done', finishReason: 'error', errorKind: 'unknown' });
  });
});

describe('toOllamaMessages（§5 FC 全映射）', () => {
  it('assistant+toolCalls → tool_calls[{function:{name,arguments:object}}]；tool role 原样', () => {
    expect(
      toOllamaMessages([
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'search', argsJson: '{"q":"cats"}' }],
        },
        { role: 'tool', content: 'r', toolCallId: 'c1' },
        { role: 'user', content: 'hi' },
      ]),
    ).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'search', arguments: { q: 'cats' } } }],
      },
      { role: 'tool', content: 'r' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('纯文本轮剥离中立字段不变；无 toolCalls 的空 assistant 仍丢弃', () => {
    expect(
      toOllamaMessages([
        { role: 'assistant', content: '' },
        { role: 'user', content: 'hi' },
      ]),
    ).toEqual([{ role: 'user', content: 'hi' }]);
  });
});
