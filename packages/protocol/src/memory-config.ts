import { z } from 'zod';

/**
 * 长期记忆事实（F-AI-06，Q6 裁定 A：最小原生）。存 SQLite memory_fact 表
 * （文本+向量+pinned，按 characterId 隔离）；本 schema 是 RPC 面的行形状（无向量）。
 * 注意与既有 facts 表（SPO 三元组，V1.0 语义记忆预留）区分——见 spec §1。
 */
export const MemoryFactSchema = z.object({
  id: z.number().int(),
  text: z.string().min(1),
  pinned: z.boolean(),
  createdAt: z.number(),
});
export type MemoryFact = z.infer<typeof MemoryFactSchema>;
