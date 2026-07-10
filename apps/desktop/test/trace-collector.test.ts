import { describe, expect, it } from 'vitest';
import type { TraceRecord } from '@openpet/protocol';
import { createTraceCollector } from '../electron/main/trace-collector.js';

describe('trace-collector（§7）', () => {
  it('record → 环形缓冲 + 逐条 broadcast trace.record', () => {
    const sent: TraceRecord[] = [];
    const c = createTraceCollector({
      broadcast: (ch, p) => {
        if (ch === 'trace.record') sent.push(p as TraceRecord);
      },
      enabled: () => true,
    });
    const span = c.span('s1', '你好');
    span.record('turn.start', { model: 'gpt' });
    span.record('turn.done');
    expect(c.history()).toHaveLength(2);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ sessionId: 's1', outline: '你好', action: 'turn.start', fields: { model: 'gpt' } });
    expect(sent[0]!.spanId).toBe(sent[1]!.spanId);
  });
  it('enabled=false → no-op；环超 max 丢最旧；clear 清空', () => {
    let on = false;
    const c = createTraceCollector({ broadcast: () => {}, enabled: () => on, max: 3 });
    c.span().record('a');
    expect(c.history()).toHaveLength(0);
    on = true;
    const s = c.span();
    for (const a of ['1', '2', '3', '4']) s.record(a);
    expect(c.history().map((r) => r.action)).toEqual(['2', '3', '4']);
    c.clear();
    expect(c.history()).toHaveLength(0);
  });
  it('不同 span 不同 spanId', () => {
    const c = createTraceCollector({ broadcast: () => {}, enabled: () => true });
    c.span('a').record('x');
    c.span('b').record('x');
    const [r1, r2] = c.history();
    expect(r1!.spanId).not.toBe(r2!.spanId);
  });
});
