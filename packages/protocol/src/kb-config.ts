import { z } from 'zod';

/**
 * 知识库（KB / 自动 RAG）协议 schema · 线 A §5。
 *
 * KB 元数据走 prefs `kb.list`（与 §1/§4 一致：列表入 prefs，重数据入 SQLite）；
 * docs/chunks 实体存 SQLite（kb_document/kb_chunk + 向量 blob）。`docCount`/`chunkCount`
 * 是 prefs 侧缓存的计数，由 kb-service 在摄入/删除时回写。
 */
export const KbSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  emoji: z.string().default('📚'),
  embeddingModelId: z.string().default(''), // 空=用 model.defaultEmbeddingModelId
  chunkSize: z.number().int().positive().default(512),
  chunkOverlap: z.number().int().nonnegative().default(50),
  topK: z.number().int().positive().default(5),
  active: z.boolean().default(true),
  /** 检索后经 rerank 模型重排（需在工作台配 rerank 能力模型并设默认）。 */
  rerank: z.boolean().default(false),
  docCount: z.number().int().nonnegative().default(0),
  chunkCount: z.number().int().nonnegative().default(0),
});
export type Kb = z.infer<typeof KbSchema>;

export const KbDocSchema = z.object({
  id: z.string(),
  kbId: z.string(),
  filename: z.string(),
  chunkCount: z.number().int().nonnegative(),
  addedAt: z.number(),
});
export type KbDoc = z.infer<typeof KbDocSchema>;

export const KbHitSchema = z.object({
  kbId: z.string(),
  docId: z.string(),
  text: z.string(),
  score: z.number(),
});
export type KbHit = z.infer<typeof KbHitSchema>;
