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
});

describe('toGeminiContents（§5 消息消毒）', () => {
  it('丢弃空 content 的 assistant（toolCalls-only）；tool → user 加前缀', () => {
    expect(
      toGeminiContents([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 't', argsJson: '{}' }] },
        { role: 'tool', content: '12:00', toolCallId: 'c1' },
      ]),
    ).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'user', parts: [{ text: '[工具结果] 12:00' }] },
    ]);
  });
});
