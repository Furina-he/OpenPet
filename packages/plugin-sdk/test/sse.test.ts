import { describe, it, expect } from 'vitest';
import { parseSseStream } from '../src/sse.js';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

describe('parseSseStream', () => {
  it('yields data payloads split across chunk boundaries', async () => {
    const s = streamOf('data: {"a":1}\n\nda', 'ta: {"b":2}\n\n', 'data: [DONE]\n\n');
    const out: string[] = [];
    for await (const ev of parseSseStream(s)) out.push(ev.data);
    expect(out).toEqual(['{"a":1}', '{"b":2}', '[DONE]']);
  });

  it('ignores comments and empty lines', async () => {
    const s = streamOf(': ping\n\ndata: x\n\n');
    const out: string[] = [];
    for await (const ev of parseSseStream(s)) out.push(ev.data);
    expect(out).toEqual(['x']);
  });

  it('captures the event name when present', async () => {
    const s = streamOf('event: content_block_delta\ndata: {"t":"hi"}\n\n');
    const out: Array<{ event?: string; data: string }> = [];
    for await (const ev of parseSseStream(s)) out.push(ev);
    expect(out[0]).toEqual({ event: 'content_block_delta', data: '{"t":"hi"}' });
  });

  it('joins multi-line data with newlines', async () => {
    const s = streamOf('data: line1\ndata: line2\n\n');
    const out: string[] = [];
    for await (const ev of parseSseStream(s)) out.push(ev.data);
    expect(out).toEqual(['line1\nline2']);
  });
});
