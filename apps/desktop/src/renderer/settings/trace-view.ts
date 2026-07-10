/** §7 诊断页分组纯逻辑（照 AstrBot TraceDisplayer.processNewTraces）。 */
import type { TraceRecord } from '@openpet/protocol';

export interface TraceSpanGroup {
  spanId: string;
  outline: string;
  sessionId: string;
  firstTs: number;
  lastTs: number;
  records: TraceRecord[];
}

export function upsertRecord(
  groups: TraceSpanGroup[],
  r: TraceRecord,
  maxSpans = 200,
): TraceSpanGroup[] {
  const idx = groups.findIndex((g) => g.spanId === r.spanId);
  if (idx === -1) {
    const g: TraceSpanGroup = {
      spanId: r.spanId,
      outline: r.outline ?? '',
      sessionId: r.sessionId ?? '',
      firstTs: r.ts,
      lastTs: r.ts,
      records: [r],
    };
    const next = [g, ...groups];
    return next.length > maxSpans ? next.slice(0, maxSpans) : next;
  }
  const g = groups[idx]!;
  const updated: TraceSpanGroup = {
    ...g,
    outline: g.outline || (r.outline ?? ''),
    firstTs: Math.min(g.firstTs, r.ts),
    lastTs: Math.max(g.lastTs, r.ts),
    records: [...g.records, r],
  };
  const next = [...groups];
  next[idx] = updated;
  return next;
}

export function groupHistory(records: TraceRecord[], maxSpans = 200): TraceSpanGroup[] {
  let groups: TraceSpanGroup[] = [];
  for (const rec of records) groups = upsertRecord(groups, rec, maxSpans);
  return groups.sort((a, b) => b.firstTs - a.firstTs);
}

export function formatFields(fields: Record<string, unknown> | undefined): string {
  if (!fields) return '';
  try {
    return JSON.stringify(fields, null, 2);
  } catch {
    return String(fields);
  }
}
