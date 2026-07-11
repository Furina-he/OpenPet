import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ChatEvent } from '@openpet/protocol';
import { getDialect } from '@openpet/protocol';
import { anthropicChat, toAnthropicMessages } from '../src/workers/providers/anthropic.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function sse(lines: string[], status = 200): Response {
  const enc = new TextEncoder();
  return new Response(
    status === 200
      ? new ReadableStream<Uint8Array>({
          start(c) {
            for (const l of lines) c.enqueue(enc.encode(l));
            c.close();
          },
        })
      : null,
    { status },
  );
}
async function collect(it: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const o: ChatEvent[] = [];
  for await (const e of it) o.push(e);
  return o;
}

describe('anthropicChat', () => {
  it('maps content_block_delta to deltas + message_delta usage + stop', async () => {
    globalThis.fetch = vi.fn(async () =>
      sse([
        'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"你"}}\n\n',
        'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"好"}}\n\n',
        'event: message_delta\ndata: {"usage":{"input_tokens":5,"output_tokens":2}}\n\n',
        'event: message_stop\ndata: {}\n\n',
      ]),
    ) as typeof fetch;
    const ev = await collect(
      anthropicChat(
        getDialect('claude')!,
        { messages: [{ role: 'user', content: 'hi' }], model: 'claude-sonnet-4-6' },
        new AbortController().signal,
      ),
    );
    expect(
      ev
        .filter((e) => e.type === 'delta')
        .map((e) => (e as { text: string }).text)
        .join(''),
    ).toBe('你好');
    expect(ev.find((e) => e.type === 'usage')).toMatchObject({ prompt: 5, completion: 2 });
    expect(ev.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('classifies a 401 as auth error done', async () => {
    globalThis.fetch = vi.fn(async () => sse([], 401)) as typeof fetch;
    const ev = await collect(
      anthropicChat(getDialect('claude')!, { messages: [] }, new AbortController().signal),
    );
    expect(ev.at(-1)).toMatchObject({ type: 'done', finishReason: 'error', errorKind: 'auth' });
  });

  it('req.tools → 请求体 tools:[{name,description,input_schema}]；无 tools 不带字段', async () => {
    const fetchMock = vi.fn(async () => sse(['event: message_stop\ndata: {}\n\n']));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await collect(
      anthropicChat(
        getDialect('claude')!,
        {
          messages: [{ role: 'user', content: 'hi' }],
          tools: [{ name: 'search', description: '搜索', parameters: { type: 'object' } }],
        },
        new AbortController().signal,
      ),
    );
    const body1 = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body1.tools).toEqual([
      { name: 'search', description: '搜索', input_schema: { type: 'object' } },
    ]);

    await collect(
      anthropicChat(
        getDialect('claude')!,
        { messages: [{ role: 'user', content: 'hi' }] },
        new AbortController().signal,
      ),
    );
    const body2 = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    expect(body2).not.toHaveProperty('tools');
  });

  it('content_block_start(tool_use) + input_json_delta 累积 → 流末 tool_call 事件', async () => {
    globalThis.fetch = vi.fn(async () =>
      sse([
        'event: content_block_start\ndata: {"index":0,"content_block":{"type":"text"}}\n\n',
        'event: content_block_delta\ndata: {"index":0,"delta":{"type":"text_delta","text":"查一下"}}\n\n',
        'event: content_block_start\ndata: {"index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"search","input":{}}}\n\n',
        'event: content_block_delta\ndata: {"index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":"}}\n\n',
        'event: content_block_delta\ndata: {"index":1,"delta":{"type":"input_json_delta","partial_json":"\\"cats\\"}"}}\n\n',
        'event: message_stop\ndata: {}\n\n',
      ]),
    ) as typeof fetch;
    const ev = await collect(
      anthropicChat(
        getDialect('claude')!,
        { messages: [{ role: 'user', content: 'hi' }] },
        new AbortController().signal,
      ),
    );
    expect(ev).toContainEqual({ type: 'delta', text: '查一下' });
    const tc = ev.find((e) => e.type === 'tool_call');
    expect(tc).toEqual({ type: 'tool_call', id: 'toolu_1', name: 'search', args: { q: 'cats' } });
    expect(ev.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('tool_use 参数坏 JSON → args._raw 兜底（照 openai-compat 模式）', async () => {
    globalThis.fetch = vi.fn(async () =>
      sse([
        'event: content_block_start\ndata: {"index":0,"content_block":{"type":"tool_use","id":"toolu_2","name":"t"}}\n\n',
        'event: content_block_delta\ndata: {"index":0,"delta":{"type":"input_json_delta","partial_json":"{oops"}}\n\n',
        'event: message_stop\ndata: {}\n\n',
      ]),
    ) as typeof fetch;
    const ev = await collect(
      anthropicChat(
        getDialect('claude')!,
        { messages: [{ role: 'user', content: 'hi' }] },
        new AbortController().signal,
      ),
    );
    expect(ev.find((e) => e.type === 'tool_call')).toEqual({
      type: 'tool_call',
      id: 'toolu_2',
      name: 't',
      args: { _raw: '{oops' },
    });
  });
});

describe('toAnthropicMessages（§5 FC 全映射）', () => {
  it('assistant+toolCalls → tool_use blocks；tool → user tool_result block（tool_use_id 对应）', () => {
    expect(
      toAnthropicMessages([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 't', argsJson: '{"q":"cats"}' }],
        },
        { role: 'tool', content: '12:00', toolCallId: 'c1' },
      ]),
    ).toEqual([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'c1', name: 't', input: { q: 'cats' } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'c1', content: '12:00' }],
      },
    ]);
  });

  it('assistant 带文本 + toolCalls → text block 在前 tool_use 在后', () => {
    expect(
      toAnthropicMessages([
        {
          role: 'assistant',
          content: '我查一下',
          toolCalls: [{ id: 'c2', name: 'search', argsJson: '{}' }],
        },
      ]),
    ).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我查一下' },
          { type: 'tool_use', id: 'c2', name: 'search', input: {} },
        ],
      },
    ]);
  });

  it('纯文本轮回归不变：string content；无 toolCalls 的空 assistant 仍丢弃', () => {
    expect(
      toAnthropicMessages([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '' },
        { role: 'assistant', content: '你好' },
      ]),
    ).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '你好' },
    ]);
  });
});
