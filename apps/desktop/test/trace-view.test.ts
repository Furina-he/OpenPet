import { describe, expect, it } from 'vitest';
import type { TraceRecord } from '@openpet/protocol';
import { groupHistory, upsertRecord } from '../src/renderer/settings/trace-view.js';

const r = (spanId: string, ts: number, action: string): TraceRecord => ({ ts, spanId, action });

describe('trace-view（§7 分组，照 TraceDisplayer.processNewTraces）', () => {
  it('groupHistory 按 span 聚合、组间按 firstTs 倒序、组内按到达顺序', () => {
    const groups = groupHistory([r('a', 1, 's'), r('b', 5, 's'), r('a', 3, 'e')]);
    expect(groups.map((g) => g.spanId)).toEqual(['b', 'a']);
    expect(groups[1]!.records.map((x) => x.action)).toEqual(['s', 'e']);
    expect(groups[1]!.firstTs).toBe(1);
    expect(groups[1]!.lastTs).toBe(3);
  });
  it('upsertRecord：新 span 插头部；超 maxSpans 丢尾', () => {
    let g = groupHistory([r('a', 1, 's')]);
    g = upsertRecord(g, r('b', 2, 's'), 2);
    g = upsertRecord(g, r('c', 3, 's'), 2);
    expect(g.map((x) => x.spanId)).toEqual(['c', 'b']);
  });
});
