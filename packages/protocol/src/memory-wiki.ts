import { z } from 'zod';
import { isMemoryPagePath } from './memory-links.js';

/**
 * ⑲ 记忆 v2：角色 wiki（spec 2026-09-22-memory-wiki-design §1/§3/§6）。
 * markdown 文件是唯一真源；本文件只定义页面 / 操作 / 树 / 状态的形状与配额常量。
 * ㉒ vault v2（spec 2026-09-24-memory-graph-design §1.3 / §2.2）：Obsidian Properties
 * （aliases / tags / created + 未知键 passthrough）；人物 / 话题文件名 = 标题（路径白名单见
 * memory-links.isMemoryPagePath）；create_page 去 slug、新增 set_props。
 */

/** ISO 日期（YYYY-MM-DD）。 */
export const MEMORY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Obsidian 标签：无空白与 `# ,`、不可纯数字、允许 `/` 嵌套。 */
export const MEMORY_TAG_RE = /^(?![0-9]+$)[^\s#,]{1,40}$/u;

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

const aliasList = z.array(z.string().min(1).max(40)).max(20);
const tagList = z.array(z.string().regex(MEMORY_TAG_RE)).max(12);

/** YAML 标量 / 单值 / null → 字符串数组（Obsidian 属性面板与手写 YAML 的常见变体）。 */
function toStrList(v: unknown): unknown {
  const arr = v == null ? [] : Array.isArray(v) ? v : [v];
  return arr.map((x) => (typeof x === 'number' || typeof x === 'boolean' ? String(x) : x));
}

/** v1 兼容：`keys` 并入 `aliases`（写回只写 aliases）；数值 alias / tag 强转字符串；tag 去前导 #。 */
function frontmatterPre(v: unknown): unknown {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  const o: Record<string, unknown> = { ...(v as Record<string, unknown>) };
  if ('keys' in o || 'aliases' in o) {
    const aliases = toStrList(o.aliases);
    const keys = toStrList(o.keys);
    o.aliases =
      Array.isArray(aliases) && Array.isArray(keys) ? [...new Set([...aliases, ...keys])] : aliases;
    delete o.keys;
  }
  if ('tags' in o) {
    // Obsidian 自己也忽略非法标签（纯数字 / 带空白）→ 读侧丢弃而非判页损坏；写侧（op）严格校验
    const tags = toStrList(o.tags);
    o.tags = Array.isArray(tags)
      ? tags
          .map((t) => (typeof t === 'string' ? t.replace(/^#/, '') : t))
          .filter((t) => typeof t === 'string' && MEMORY_TAG_RE.test(t))
          .slice(0, 12)
      : tags;
  }
  if (typeof o.title === 'number') o.title = String(o.title);
  for (const k of ['summary', 'created'] as const) if (o[k] == null) delete o[k];
  return o;
}

export const MemoryPageFrontmatterSchema = z.preprocess(
  frontmatterPre,
  z
    .object({
      title: z.string().min(1).max(100),
      aliases: aliasList.default([]),
      tags: tagList.default([]),
      summary: z.string().max(200).default(''),
      created: z.string().regex(MEMORY_DATE_RE).optional(),
      updated: z.string().regex(MEMORY_DATE_RE),
      source: MemoryPageSourceSchema.default('llm'),
    })
    // 用户在 Obsidian 里自加的属性（cssclasses 等）原样保留，改写页面不丢
    .passthrough(),
);
export type MemoryPageFrontmatter = z.infer<typeof MemoryPageFrontmatterSchema>;

const pagePath = z.string().refine(isMemoryPagePath, '非法页面路径');

export const MemoryPageSchema = z.object({
  path: pagePath,
  frontmatter: MemoryPageFrontmatterSchema,
  body: z.string().max(20_000),
});
export type MemoryPage = z.infer<typeof MemoryPageSchema>;

const sectionName = z.string().min(1).max(60);
const isoDate = z.string().regex(MEMORY_DATE_RE);

/** 编译器 op 预处理：create_page 的 v1 `keys` 并入 `aliases`（`slug` 由 Zod 默认 strip 忽略）。 */
function opPre(v: unknown): unknown {
  if (!v || typeof v !== 'object' || (v as { op?: unknown }).op !== 'create_page') return v;
  const o: Record<string, unknown> = { ...(v as Record<string, unknown>) };
  if ('keys' in o) {
    const keys = toStrList(o.keys);
    const aliases = toStrList(o.aliases);
    if (Array.isArray(keys) && Array.isArray(aliases)) o.aliases = [...new Set([...aliases, ...keys])];
    delete o.keys;
  }
  return o;
}

/** 编译器 v3.1 输出契约（§2.2 六种操作）；任一非法 → 整批丢弃（校验在 MemoryOpsSchema）。 */
export const MemoryOpSchema = z
  .preprocess(
    opPre,
    z.discriminatedUnion('op', [
      z.object({
        op: z.literal('upsert_section'),
        page: pagePath,
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
        title: z.string().trim().min(1).max(100),
        aliases: aliasList.default([]),
        tags: tagList.default([]),
        content: z.string().min(1).max(MEMORY_QUOTAS.pageChars),
      }),
      z.object({
        op: z.literal('set_props'),
        page: pagePath,
        aliases: aliasList.optional(),
        tags: tagList.optional(),
        summary: z.string().max(200).optional(),
      }),
      z.object({
        op: z.literal('remove_line'),
        page: pagePath,
        section: sectionName,
        match: z.string().min(1).max(200),
      }),
      z.object({
        op: z.literal('merge_timeline'),
        before: isoDate,
        text: z.string().min(1).max(1000),
      }),
    ]),
  )
  .superRefine((op, ctx) => {
    if (
      op.op === 'set_props' &&
      op.aliases === undefined &&
      op.tags === undefined &&
      op.summary === undefined
    )
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'set_props 至少给一项' });
  });
export type MemoryOp = z.infer<typeof MemoryOpSchema>;
export const MemoryOpsSchema = z.array(MemoryOpSchema).max(MEMORY_QUOTAS.opsPerBatch);

export const MemoryTreeNodeSchema = z.object({
  path: z.string(),
  title: z.string(),
  summary: z.string(),
  updated: z.string(),
  source: MemoryPageSourceSchema,
  aliases: z.array(z.string()),
  tags: z.array(z.string()),
  /** 固定页 frontmatter 无法解析（Obsidian 里改坏）：占位节点，F3 标红提示可在编辑器修复。 */
  broken: z.boolean().optional(),
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
      /** ㉒ 撞名并入：[新标题, 并入页路径]（「合并了 1 个重复人物」）。 */
      merged: z.array(z.tuple([z.string(), z.string()])).optional(),
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

// ---------- ㉒ 记忆图谱（spec 2026-09-24-memory-graph-design §3 / §4.6 / §6）----------

export const MemoryGraphNodeKindSchema = z.enum([
  'profile',
  'people',
  'topics',
  'relationship',
  'timeline',
  'ghost',
]);
export type MemoryGraphNodeKind = z.infer<typeof MemoryGraphNodeKindSchema>;

export const MemoryGraphNodeSchema = z.object({
  /** 页路径；未建页面 = `ghost:<规范化名>`。 */
  id: z.string(),
  /** 可读名：profile =「我」；relationship / timeline =「角色名 · 关系 / 经历」；其余 = title。 */
  title: z.string(),
  kind: MemoryGraphNodeKindSchema,
  characterId: z.string().optional(),
  tags: z.array(z.string()),
  aliases: z.array(z.string()),
  updated: z.string().optional(),
  chars: z.number().int().nonnegative(),
  /** 他角色页（scope=all 时出现）。 */
  readonly: z.boolean(),
  /** §3.1 被想起的痕迹；只有人物 / 话题有。 */
  recall: z.object({ count: z.number().int().nonnegative(), lastAt: z.number() }).optional(),
});
export type MemoryGraphNode = z.infer<typeof MemoryGraphNodeSchema>;

export const MemoryGraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  /** link = 显式双链；mention = 未链接提及（默认隐藏）。 */
  kind: z.enum(['link', 'mention']),
  count: z.number().int().positive(),
  /** 首次出现所在行的纯文本（≤80 字，悬停边时显示）。 */
  context: z.string().optional(),
});
export type MemoryGraphEdge = z.infer<typeof MemoryGraphEdgeSchema>;

export const MemoryGraphSchema = z.object({
  nodes: z.array(MemoryGraphNodeSchema),
  edges: z.array(MemoryGraphEdgeSchema),
  stats: z.object({
    pages: z.number().int().nonnegative(),
    links: z.number().int().nonnegative(),
    ghosts: z.number().int().nonnegative(),
    orphans: z.number().int().nonnegative(),
  }),
});
export type MemoryGraph = z.infer<typeof MemoryGraphSchema>;

/** §4.6「试一句」：与聊天同一个 retrieveForChat 的命中结构 + 注入原文（不记统计）。 */
export const MemoryProbeResultSchema = z.object({
  resident: z.array(z.object({ title: z.string(), chars: z.number().int().nonnegative() })),
  pages: z.array(
    z.object({
      path: z.string(),
      title: z.string(),
      via: z.enum(['keyword', 'vector']),
      score: z.number().optional(),
      chars: z.number().int().nonnegative(),
    }),
  ),
  injectedChars: z.number().int().nonnegative(),
  budget: z.number().int().nonnegative(),
  /** 所见即所注入：与组装链同一个 formatMemoryBlock 渲染；无命中 = ''。 */
  preview: z.string(),
});
export type MemoryProbeResult = z.infer<typeof MemoryProbeResultSchema>;
