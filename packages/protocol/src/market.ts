import { z } from 'zod';
import { CHARACTER_ID_RE, PackPersonaSchema } from './character-manifest.js';
import { PackLorebookSchema } from './lorebook.js';

/**
 * ⑯ 角色市场 v1 —— 静态索引协议（spec §1/§2）。
 *
 * 零服务器：GitHub 仓 + `index.json`（AstrBot 插件市场同款形状）。索引不可信，
 * 逐条 safeParse 丢坏条目；下载物一律 sha256 校验后走既有 `pack-import` 安全门。
 *
 * 商品三型：
 *   - `full` —— 完整 .dspack（含模型文件；上架需声明模型可再分发）
 *   - `soul` —— .dssoul 灵魂包（纯文本人设/世界书），安装时与已装包的形象（donor）合成
 *   - `ref`  —— 灵魂包 + 推荐模型外链（模型不托管，规避 Live2D/Booth 再分发禁令）；
 *               安装路径与 soul 相同，额外展示 `modelSource` 指引让用户自备形象包
 */

/** 索引仓（T6 骨架推到这里；UI 「关于市场」外链）。 */
export const MARKET_REPO_URL = 'https://github.com/Furina-he/openpet-market';
/** 官方源①：jsDelivr CDN（直连 GitHub 不通时的主路径）。 */
export const MARKET_SOURCE_JSDELIVR =
  'https://cdn.jsdelivr.net/gh/Furina-he/openpet-market@main/index.json';
/** 官方源②：GitHub raw（CDN 缓存未刷新时的即时路径）。 */
export const MARKET_SOURCE_GITHUB_RAW =
  'https://raw.githubusercontent.com/Furina-he/openpet-market/main/index.json';
export const DEFAULT_MARKET_SOURCES = [MARKET_SOURCE_JSDELIVR, MARKET_SOURCE_GITHUB_RAW] as const;

export const MarketItemTypeSchema = z.enum(['soul', 'full', 'ref']);
export type MarketItemType = z.infer<typeof MarketItemTypeSchema>;

/** ref 型的模型获取指引（不托管模型文件，UI 外链 + 说明）。 */
export const ModelSourceSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  note: z.string().max(400).optional(),
});
export type ModelSource = z.infer<typeof ModelSourceSchema>;

export const SHA256_RE = /^[0-9a-f]{64}$/i;

export const MarketItemSchema = z
  .object({
    /** 与包内 manifest.id / soul.json id 一致（asset:// host 口径，禁大写）。 */
    id: z.string().regex(CHARACTER_ID_RE),
    name: z.string().min(1).max(100),
    version: z.string().min(1).max(40),
    type: MarketItemTypeSchema,
    summary: z.string().max(200).optional(),
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
    author: z.string().min(1).max(100).optional(),
    /** 必填——无许可不上架（spec §4）。 */
    license: z.string().min(1).max(200),
    preview: z.string().url().optional(),
    downloadUrl: z.string().url(),
    size: z.number().int().nonnegative().optional(),
    /** 必填——下载后校验，不符即拒（spec §3）。 */
    sha256: z.string().regex(SHA256_RE),
    /** 低于此版本 UI 灰掉「需要升级」。 */
    minAppVersion: z.string().min(1).max(40).optional(),
    /** 仅 ref 型：模型获取指引。 */
    modelSource: ModelSourceSchema.optional(),
  })
  .superRefine((item, ctx) => {
    if (item.type === 'ref' && !item.modelSource) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['modelSource'],
        message: 'ref 型条目必须提供 modelSource（模型获取指引）',
      });
    }
  });
export type MarketItem = z.infer<typeof MarketItemSchema>;

export const MarketIndexSchema = z.object({
  version: z.literal(1),
  updatedAt: z.number().optional(),
  items: z.array(z.unknown()).default([]),
});

export interface ParsedMarketIndex {
  items: MarketItem[];
  /** 校验失败被丢弃的条目数（UI 提示「N 条无效条目已忽略」）。 */
  dropped: number;
}

/**
 * 索引容错解析：接受 `{version:1, items:[]}` 与裸数组两种形状（照 `plugins.marketFetch`）；
 * **逐条 safeParse，坏条目丢弃不整份失败**（一个作者写错字段不该让整个市场空掉）。
 */
export function parseMarketIndex(raw: unknown): ParsedMarketIndex {
  let list: unknown[];
  if (Array.isArray(raw)) {
    list = raw;
  } else {
    const outer = MarketIndexSchema.safeParse(raw);
    if (outer.success) {
      list = outer.data.items;
    } else if (
      typeof raw === 'object' &&
      raw !== null &&
      Array.isArray((raw as { items?: unknown }).items)
    ) {
      list = (raw as { items: unknown[] }).items; // version 字段缺失/错版 → 仍尽力取 items
    } else {
      return { items: [], dropped: 0 };
    }
  }
  const items: MarketItem[] = [];
  let dropped = 0;
  for (const entry of list) {
    const parsed = MarketItemSchema.safeParse(entry);
    if (parsed.success) items.push(parsed.data);
    else dropped++;
  }
  return { items, dropped };
}

/**
 * 版本比较（数字段逐段比；非数字段按 0，长度不等短的补 0）。
 * 只用于「可更新」判定与 minAppVersion 门，不追求 semver 全套（预发布后缀忽略）。
 */
export function compareVersion(a: string, b: string): number {
  const seg = (v: string): number[] =>
    String(v)
      .trim()
      .replace(/^v/i, '')
      .split(/[.\-+]/)
      .map((s) => {
        const n = Number.parseInt(s, 10);
        return Number.isFinite(n) ? n : 0;
      });
  const sa = seg(a);
  const sb = seg(b);
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const d = (sa[i] ?? 0) - (sb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * 灵魂包 `.dssoul` 根部 `soul.json`（spec §2）——字段全部复用现有 schema，无新语义。
 * 安装 = 灵魂（本 schema）+ donor 形象（engine/model/词表/cues）合成完整角色包。
 */
export const SoulPackSchema = z.object({
  id: z.string().regex(CHARACTER_ID_RE),
  name: z.string().min(1).max(100),
  version: z.string().min(1).max(40),
  persona: PackPersonaSchema,
  lorebook: PackLorebookSchema.optional(),
  author: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  license: z.string().min(1).max(200).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  /** 「推荐配某某音色/模型」仅文案，不做校验（spec §6）。 */
  voiceHint: z.string().max(200).optional(),
});
export type SoulPack = z.infer<typeof SoulPackSchema>;
