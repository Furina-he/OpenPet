import { z } from 'zod';

/**
 * §7 Trace —— 诊断时间线单条记录（照 AstrBot TraceSpan.record 的 payload，字段化到 openpet）。
 * 一轮对话一个 spanId（Main 侧 randomUUID）；records 经 'trace.record' 通知直发 + Main 环形缓冲。
 * 隐私口径见 spec §3.1：outline ≤60 字符、fields 不含 prompt/工具结果正文。
 */
export const TraceRecordSchema = z.object({
  ts: z.number(),
  spanId: z.string(),
  sessionId: z.string().optional(),
  outline: z.string().optional(),
  action: z.string(),
  fields: z.record(z.unknown()).optional(),
});
export type TraceRecord = z.infer<typeof TraceRecordSchema>;
