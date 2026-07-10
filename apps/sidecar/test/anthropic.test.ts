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
});

describe('toAnthropicMessages（§5 消息消毒，照 8213c14 精神）', () => {
  it('丢弃空 content 的 assistant（toolCalls-only）；tool → user 加前缀', () => {
    expect(
      toAnthropicMessages([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 't', argsJson: '{}' }] },
        { role: 'tool', content: '12:00', toolCallId: 'c1' },
      ]),
    ).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'user', content: '[工具结果] 12:00' },
    ]);
  });
});
