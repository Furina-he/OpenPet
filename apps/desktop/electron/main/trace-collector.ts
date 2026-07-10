/**
 * TraceCollector —— §7 诊断时间线（照 AstrBot TraceSpan：一轮一 span + record(action, fields)）。
 * 内存环形缓冲（默认 600 条，仅内存不落盘）；record 同步 broadcast 'trace.record'（直发，
 * 不进背压队列——诊断流无合并/重放需求）。开关 = 注入 enabled()（读 prefs trace.enabled）。
 * 隐私口径（spec §3.1）：outline ≤60 字符；fields 不放 prompt/工具结果正文。
 */
import { randomUUID } from 'node:crypto';
import type { TraceRecord } from '@openpet/protocol';

export interface TraceSpanHandle {
  record: (action: string, fields?: Record<string, unknown>) => void;
}

export interface TraceCollector {
  span: (sessionId?: string, outline?: string) => TraceSpanHandle;
  history: () => TraceRecord[];
  clear: () => void;
}

export interface TraceCollectorDeps {
  broadcast: (channel: string, params: unknown) => void;
  enabled: () => boolean;
  max?: number;
}

export function createTraceCollector(deps: TraceCollectorDeps): TraceCollector {
  const max = deps.max ?? 600;
  const records: TraceRecord[] = [];
  return {
    span(sessionId?: string, outline?: string): TraceSpanHandle {
      const spanId = randomUUID();
      return {
        record(action: string, fields?: Record<string, unknown>): void {
          if (!deps.enabled()) return;
          const r: TraceRecord = {
            ts: Date.now(),
            spanId,
            action,
            ...(sessionId ? { sessionId } : {}),
            ...(outline ? { outline } : {}),
            ...(fields ? { fields } : {}),
          };
          records.push(r);
          if (records.length > max) records.splice(0, records.length - max);
          deps.broadcast('trace.record', r);
        },
      };
    },
    history: () => [...records],
    clear: () => {
      records.length = 0;
    },
  };
}
