import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ChatEvent } from '@openpet/protocol';
import { getDialect } from '@openpet/protocol';
import { geminiChat, toGeminiContents } from '../src/workers/providers/gemini.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function sse(lines: string[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const l of lines) c.enqueue(enc.encode(l));
        c.close();
      },
    }),
    { status: 200 },
  );
}
async function collect(it: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const o: ChatEvent[] = [];
  for await (const e of it) o.push(e);
  return o;
}

describe('geminiChat', () => {
  it('maps candidates[].content.parts[].text to deltas', async () => {
    globalThis.fetch = vi.fn(async () =>
      sse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"!"}]}}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":1}}\n\n',
      ]),
    ) as typeof fetch;
    const ev = await collect(
      geminiChat(
        getDialect('gemini')!,
        { messages: [{ role: 'user', content: 'hi' }], model: 'gemini-1.5-flash' },
        new AbortController().signal,
      ),
    );
    expect(
      ev
        .filter((e) => e.type === 'delta')
        .map((e) => (e as { text: string }).text)
        .join(''),
    ).toBe('Hi!');
    expect(ev.find((e) => e.type === 'usage')).toMatchObject({ prompt: 3, completion: 1 });
    expect(ev.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('req.tools → 请求体 tools:[{functionDeclarations}]；无 tools 不带字段', async () => {
    const fetchMock = vi.fn(async () => sse([]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await collect(
      geminiChat(
        getDialect('gemini')!,
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
        functionDeclarations: [
          { name: 'search', description: '搜索', parameters: { type: 'object' } },
        ],
      },
    ]);

    await collect(
      geminiChat(
        getDialect('gemini')!,
        { messages: [{ role: 'user', content: 'hi' }] },
        new AbortController().signal,
      ),
    );
    const body2 = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    expect(body2).not.toHaveProperty('tools');
  });

  it('parts.functionCall → tool_call 事件（合成 id call_<name>_<i>）', async () => {
    globalThis.fetch = vi.fn(async () =>
      sse([
        'data: {"candidates":[{"content":{"parts":[{"text":"查一下"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"search","args":{"q":"cats"}}},{"functionCall":{"name":"calc","args":{"x":1}}}]}}]}\n\n',
      ]),
    ) as typeof fetch;
    const ev = await collect(
      geminiChat(
        getDialect('gemini')!,
        { messages: [{ role: 'user', content: 'hi' }] },
        new AbortController().signal,
      ),
    );
    expect(ev).toContainEqual({ type: 'delta', text: '查一下' });
    expect(ev.filter((e) => e.type === 'tool_call')).toEqual([
      { type: 'tool_call', id: 'call_search_0', name: 'search', args: { q: 'cats' } },
      { type: 'tool_call', id: 'call_calc_1', name: 'calc', args: { x: 1 } },
    ]);
    expect(ev.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });
});

describe('toGeminiContents（§5 FC 全映射）', () => {
  it('assistant+toolCalls → model functionCall parts；tool → user functionResponse（按 toolCallId 反查 name）', () => {
    expect(
      toGeminiContents([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'search', argsJson: '{"q":"cats"}' }],
        },
        { role: 'tool', content: '12:00', toolCallId: 'c1' },
      ]),
    ).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ functionCall: { name: 'search', args: { q: 'cats' } } }] },
      {
        role: 'user',
        parts: [{ functionResponse: { name: 'search', response: { result: '12:00' } } }],
      },
    ]);
  });

  it('assistant 带文本 + toolCalls → text part 在前 functionCall 在后', () => {
    expect(
      toGeminiContents([
        {
          role: 'assistant',
          content: '我查一下',
          toolCalls: [{ id: 'c2', name: 'calc', argsJson: '{}' }],
        },
      ]),
    ).toEqual([
      {
        role: 'model',
        parts: [{ text: '我查一下' }, { functionCall: { name: 'calc', args: {} } }],
      },
    ]);
  });

  it('纯文本轮回归不变；无 toolCalls 的空 assistant 仍丢弃', () => {
    expect(
      toGeminiContents([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '' },
        { role: 'assistant', content: '你好' },
      ]),
    ).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: '你好' }] },
    ]);
  });
});
