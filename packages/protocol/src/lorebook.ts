import { z } from 'zod';

/**
 * ⑫ Lorebook（SillyTavern 融合②，最小子集）：关键词触发的条目注入。
 * 只做 keys + scanDepth + token 预算；递归/二级键/position/probability 明确不做（spec §1）。
 * 数据源 = ST 卡 character_book 导入或 E4 手编；注入点 = context-assembler「世界设定」块。
 */
export const LorebookEntrySchema = z.object({
  /** 触发关键词（子串匹配）；空 keys 仅在 constant 时有意义。 */
  keys: z.array(z.string().min(1)).max(20).default([]),
  content: z.string().min(1).max(8000),
  enabled: z.boolean().default(true),
  insertionOrder: z.number().int().default(100),
  caseSensitive: z.boolean().default(false),
  /** 常驻（不需关键词命中）。 */
  constant: z.boolean().default(false),
  /** 编辑器展示名（ST comment/name）。 */
  name: z.string().max(100).optional(),
});
export type LorebookEntry = z.infer<typeof LorebookEntrySchema>;

export const PackLorebookSchema = z.object({
  name: z.string().max(100).optional(),
  /** 扫描最近 N 条消息（当前输入始终参与）。 */
  scanDepth: z.number().int().min(1).max(20).default(4),
  tokenBudget: z.number().int().min(50).max(8000).default(1024),
  entries: z.array(LorebookEntrySchema).max(200).default([]),
});
export type PackLorebook = z.infer<typeof PackLorebookSchema>;

export interface LorebookScanInput {
  /** 最近消息文本（旧→新）；内部按 scanDepth 取尾窗。 */
  history: readonly string[];
  /** 当前用户输入。 */
  current: string;
}

/** 关键词激活：返回按 insertionOrder 升序的 content 列表（预算内；至少一条防静默全丢）。 */
export function activateLorebook(book: PackLorebook, scan: LorebookScanInput): string[] {
  const window = [...scan.history.slice(-book.scanDepth), scan.current].join('\n');
  const lower = window.toLowerCase();
  const hits = book.entries
    .filter((e) => e.enabled)
    .filter(
      (e) =>
        e.constant ||
        e.keys.some((k) => (e.caseSensitive ? window.includes(k) : lower.includes(k.toLowerCase()))),
    )
    .sort((a, b) => a.insertionOrder - b.insertionOrder);
  const budgetChars = book.tokenBudget * 2; // 无 tokenizer 的诚实近似：1 token ≈ 2 chars（spec §1）
  const out: string[] = [];
  let used = 0;
  for (const e of hits) {
    if (out.length > 0 && used + e.content.length > budgetChars) break;
    out.push(e.content);
    used += e.content.length;
  }
  return out;
}
