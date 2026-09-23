import { z } from 'zod';

/**
 * ⑲ 记忆 v2：角色 wiki（spec 2026-09-22-memory-wiki-design §1/§3/§6）。
 * markdown 文件是唯一真源；本文件只定义页面 / 操作 / 树 / 状态的形状与配额常量。
 */

/** 页面 slug（people/topics 文件名；与 characterId 同源）。 */
export const MEMORY_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
/** ISO 日期（YYYY-MM-DD）。 */
export const MEMORY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * 页面相对路径白名单（相对 userData/memory/）：
 * user/profile.md · user/people/<slug>.md · user/topics/<slug>.md ·
 * characters/<cid>/relationship.md · characters/<cid>/timeline.md
 */
export const MEMORY_PAGE_PATH_RE =
  /^(?:user\/profile\.md|user\/(?:people|topics)\/[a-z0-9][a-z0-9-]{0,40}\.md|characters\/[a-z0-9][a-z0-9-]*\/(?:relationship|timeline)\.md)$/;

/** profile.md 固定节（顺序即渲染顺序）；「一句话档案」= 常驻精简视图（§2 路 1）。 */
export const MEMORY_PROFILE_SECTIONS = [
  '一句话档案',
  '身份',
  '工作学习',
  '习惯作息',
  '喜好厌恶',
  '近况',
  '杂项',
] as const;
/** relationship.md 固定节。 */
export const MEMORY_RELATIONSHIP_SECTIONS = ['称呼', '约定', '禁忌', '亲密度叙事'] as const;
/** 节首行锁定标记：用户写入后 LLM 不得改写该节（替代旧 pinned 语义）。 */
export const MEMORY_LOCKED_MARK = '<!-- locked -->';

/** 配额定稿（§1 / §2 / §3）；写侧硬拒 + prompt 明示。 */
export const MEMORY_QUOTAS = {
  /** profile.md 正文总字数上限。 */
  profileChars: 3000,
  /** people/topics 各自页数上限。 */
  pagesPerKind: 60,
  /** people/topics 单页正文上限。 */
  pageChars: 2000,
  /** timeline 条目数上限（超出编译器须先 merge_timeline）。 */
  timelineEntries: 200,
  /** 单条 timeline 文本上限。 */
  timelineEntryChars: 200,
  /** 单节内容上限（upsert_section）。 */
  sectionChars: 2000,
  /** 单批操作数上限。 */
  opsPerBatch: 5,
  /** 常驻：profile「一句话档案」节上限。 */
  residentProfileChars: 600,
  /** 常驻：relationship.md 全文上限。 */
  residentRelationshipChars: 400,
  /** 常驻：timeline 最近 N 条。 */
  residentTimelineEntries: 3,
  /** 注入总预算（常驻 > 关键词 > 向量 顺序截断）。 */
  injectBudgetChars: 2500,
  /** 关键词路 lorebook 预算（token；activateLorebook 内 ×2 近似字数）。 */
  keywordTokenBudget: 1200,
  /** 关键词路扫描深度。 */
  keywordScanDepth: 4,
  /** 向量兜底页数。 */
  vectorPages: 2,
  /** 编译器输入相关页上限。 */
  compilerPages: 5,
  /** 编译器输入相关页总字数上限。 */
  compilerPageChars: 6000,
} as const;

export const MemoryPageSourceSchema = z.enum(['llm', 'user']);
export const MemoryPageFrontmatterSchema = z.object({
  title: z.string().min(1).max(100),
  keys: z.array(z.string().min(1).max(40)).max(20).default([]),
  summary: z.string().max(200).default(''),
  updated: z.string().regex(MEMORY_DATE_RE),
  source: MemoryPageSourceSchema.default('llm'),
});
export type MemoryPageFrontmatter = z.infer<typeof MemoryPageFrontmatterSchema>;

export const MemoryPageSchema = z.object({
  path: z.string().regex(MEMORY_PAGE_PATH_RE),
  frontmatter: MemoryPageFrontmatterSchema,
  body: z.string().max(20_000),
});
export type MemoryPage = z.infer<typeof MemoryPageSchema>;

const sectionName = z.string().min(1).max(60);
const slug = z.string().regex(MEMORY_SLUG_RE);
const isoDate = z.string().regex(MEMORY_DATE_RE);

/** 编译器 v3 输出契约（§3 五种操作）；任一非法 → 整批丢弃（校验在 MemoryOpsSchema）。 */
export const MemoryOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('upsert_section'),
    page: z.string().regex(MEMORY_PAGE_PATH_RE),
    section: sectionName,
    content: z.string().min(1).max(MEMORY_QUOTAS.sectionChars),
  }),
  z.object({
    op: z.literal('append_timeline'),
    date: isoDate,
    text: z.string().min(1).max(MEMORY_QUOTAS.timelineEntryChars),
  }),
  z.object({
    op: z.literal('create_page'),
    kind: z.enum(['people', 'topics']),
    slug,
    title: z.string().min(1).max(100),
    keys: z.array(z.string().min(1).max(40)).max(20).default([]),
    content: z.string().min(1).max(MEMORY_QUOTAS.pageChars),
  }),
  z.object({
    op: z.literal('remove_line'),
    page: z.string().regex(MEMORY_PAGE_PATH_RE),
    section: sectionName,
    match: z.string().min(1).max(200),
  }),
  z.object({
    op: z.literal('merge_timeline'),
    before: isoDate,
    text: z.string().min(1).max(1000),
  }),
]);
export type MemoryOp = z.infer<typeof MemoryOpSchema>;
export const MemoryOpsSchema = z.array(MemoryOpSchema).max(MEMORY_QUOTAS.opsPerBatch);

export const MemoryTreeNodeSchema = z.object({
  path: z.string(),
  title: z.string(),
  summary: z.string(),
  updated: z.string(),
  source: MemoryPageSourceSchema,
});
export type MemoryTreeNode = z.infer<typeof MemoryTreeNodeSchema>;
/** F3 左栏树（§5）：用户档案 / 人物 / 话题 / 本角色·关系 / 本角色·时间线。 */
export const MemoryTreeSchema = z.object({
  profile: MemoryTreeNodeSchema,
  people: z.array(MemoryTreeNodeSchema),
  topics: z.array(MemoryTreeNodeSchema),
  relationship: MemoryTreeNodeSchema,
  timeline: MemoryTreeNodeSchema,
});
export type MemoryTree = z.infer<typeof MemoryTreeSchema>;

export const MemoryStatusSchema = z.object({
  /** privacy.longTermMemory 总闸。 */
  enabled: z.boolean(),
  pageCount: z.number().int().nonnegative(),
  lastCompile: z
    .object({
      at: z.number(),
      ok: z.boolean(),
      ops: z.number().int().nonnegative(),
      error: z.string().optional(),
    })
    .nullable(),
  /** §4 一次性迁移记录（当前角色）；null = 未迁移过。 */
  migration: z
    .object({ characterId: z.string(), from: z.number().int(), at: z.number() })
    .nullable(),
  /** 当前角色旧 memory_fact 行数（横幅「旧数据仍保留」）。 */
  legacyFacts: z.number().int().nonnegative(),
});
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;
