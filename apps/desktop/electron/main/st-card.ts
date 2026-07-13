/**
 * ⑫ SillyTavern 角色卡解析（纯 Node，无 Electron 依赖）——spec §2。
 * 三载体：PNG tEXt（chara=V2 / ccv3=V3，V3 优先）· .charx（zip 的 card.json）· .json。
 * PNG chunk 走查零依赖自研；亦可直接换用 ST 同款 MIT 依赖 png-chunks-extract + png-chunk-text（spec §8 复用分级①，npmmirror 安装），对外 API 不变。
 * 归一：V2/V3 取 data.*、V1 顶层；逐字段 catch 容错 + 控制字符剥离 + 长度上限（注入面清洗口径）。
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { z } from 'zod';
import { CHARACTER_ID_RE, PackLorebookSchema, type PackLorebook } from '@openpet/protocol';

const MAX_CARD_BYTES = 50 * 1024 * 1024;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const AVATAR_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

export function sanitizeText(s: string, max: number): string {
  const clean = s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return clean.length > max ? clean.slice(0, max) : clean;
}

const CARD_TEXT = (max: number) => z.string().catch('').transform((s) => sanitizeText(s, max));
const CARD_STR_ARRAY = (maxEach: number, maxLen: number) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((a) =>
      a
        .filter((x): x is string => typeof x === 'string')
        .map((s) => sanitizeText(s, maxEach))
        .filter((s) => s.trim().length > 0)
        .slice(0, maxLen),
    );

/** V2 spec 字段白名单（未知字段丢弃）；V3 增量字段按同名兼容，其余丢弃（spec §2 映射表）。 */
export const StCardSchema = z.object({
  name: CARD_TEXT(100),
  description: CARD_TEXT(20000),
  personality: CARD_TEXT(4000),
  scenario: CARD_TEXT(4000),
  first_mes: CARD_TEXT(4000),
  mes_example: CARD_TEXT(8000),
  system_prompt: CARD_TEXT(8000),
  post_history_instructions: CARD_TEXT(2000),
  creator: CARD_TEXT(100),
  creator_notes: CARD_TEXT(2000),
  character_version: CARD_TEXT(40),
  alternate_greetings: CARD_STR_ARRAY(4000, 20),
  tags: CARD_STR_ARRAY(40, 20),
  character_book: z.unknown().optional(),
});
export type StCard = z.infer<typeof StCardSchema>;

/** PNG tEXt 走查：ccv3 优先于 chara（照 ST 读取语义）；不验 CRC（宽容读取）。 */
export function readStCardFromPng(buf: Buffer): unknown {
  if (buf.length < 8 + 12 || !buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('不是 PNG 文件');
  const texts = new Map<string, string>();
  let off = 8;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (off + 12 + len > buf.length) break; // 截断容错
    if (type === 'tEXt') {
      const data = buf.subarray(off + 8, off + 8 + len);
      const nul = data.indexOf(0);
      if (nul > 0) texts.set(data.toString('latin1', 0, nul).toLowerCase(), data.toString('latin1', nul + 1));
    }
    if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = texts.get('ccv3') ?? texts.get('chara');
  if (!raw) throw new Error('PNG 中没有角色卡数据（缺 chara/ccv3 tEXt 块）');
  return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as unknown;
}

export function normalizeStCard(raw: unknown): StCard {
  if (typeof raw !== 'object' || raw === null) throw new Error('角色卡不是 JSON 对象');
  const obj = raw as Record<string, unknown>;
  const data =
    typeof obj['data'] === 'object' && obj['data'] !== null ? (obj['data'] as Record<string, unknown>) : obj;
  const card = StCardSchema.parse(data);
  if (card.name.trim().length === 0) throw new Error('角色卡缺少 name 字段');
  return card;
}

export interface StCardAvatar {
  buf: Buffer;
  ext: string;
}

function readCharxIcon(zip: AdmZip, raw: unknown): StCardAvatar | null {
  // V3 data.assets：[{type:'icon', uri:'embeded://<zip 内路径>', name, ext}]（'embeded' 拼写照 RisuAI 导出，另兼容 embedded/__asset:）
  const data = (raw as { data?: { assets?: unknown } }).data;
  const assets = Array.isArray(data?.assets) ? (data.assets as Array<Record<string, unknown>>) : [];
  const icons = assets.filter((a) => a['type'] === 'icon' && typeof a['uri'] === 'string');
  const icon = icons.find((a) => a['name'] === 'main') ?? icons[0];
  if (!icon) return null;
  const uri = String(icon['uri']);
  const zipPath = uri.replace(/^(?:embeded|embedded):\/\//i, '').replace(/^__asset:/i, '');
  if (zipPath === uri) return null; // 非内嵌 URI（http 等）不取
  const entry = zip.getEntry(zipPath.replace(/^\/+/, ''));
  if (!entry) return null;
  const rawExt = (typeof icon['ext'] === 'string' ? icon['ext'] : path.extname(zipPath)).toLowerCase().replace(/^\./, '');
  return { buf: entry.getData(), ext: AVATAR_EXTS.has(rawExt) ? rawExt : 'png' };
}

/** 按扩展名分发读卡；返回归一卡数据 + 头像（json 无头像）。 */
export function readStCard(cardPath: string): { card: StCard; avatar: StCardAvatar | null } {
  const ext = path.extname(cardPath).toLowerCase();
  if (ext !== '.png' && ext !== '.charx' && ext !== '.json')
    throw new Error(`不支持的角色卡格式: ${ext || '(无扩展名)'}`);
  if (statSync(cardPath).size > MAX_CARD_BYTES) throw new Error('角色卡文件超过 50MB 上限');
  if (ext === '.png') {
    const buf = readFileSync(cardPath);
    return { card: normalizeStCard(readStCardFromPng(buf)), avatar: { buf, ext: 'png' } };
  }
  if (ext === '.charx') {
    const zip = new AdmZip(cardPath);
    const entry = zip.getEntry('card.json');
    if (!entry) throw new Error('charx 包缺少 card.json');
    const raw = JSON.parse(zip.readAsText(entry)) as unknown;
    return { card: normalizeStCard(raw), avatar: readCharxIcon(zip, raw) };
  }
  if (ext === '.json') {
    return { card: normalizeStCard(JSON.parse(readFileSync(cardPath, 'utf8')) as unknown), avatar: null };
  }
  throw new Error(`不支持的角色卡格式: ${ext}`); // unreachable（入口已白名单）
}

export interface StCardSoul {
  name: string;
  version: string;
  author?: string;
  description?: string;
  tags?: string[];
  persona: {
    systemPrompt: string;
    beginDialogs: string[];
    greetings?: string[];
    styleAnchor?: string;
  };
  lorebook?: PackLorebook;
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dflt;
  return Math.min(max, Math.max(min, n));
}

/** character_book → PackLorebook（最小子集；容错走查，坏条目丢弃）。 */
export function mapCharacterBook(raw: unknown): PackLorebook | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const book = raw as Record<string, unknown>;
  const entriesRaw = Array.isArray(book['entries'])
    ? (book['entries'] as unknown[])
    : typeof book['entries'] === 'object' && book['entries'] !== null
      ? Object.values(book['entries'] as Record<string, unknown>) // ST world info 文件形态 {uid: entry}
      : [];
  const entries = entriesRaw
    .flatMap((r) => {
      if (typeof r !== 'object' || r === null) return [];
      const e = r as Record<string, unknown>;
      const content = typeof e['content'] === 'string' ? sanitizeText(e['content'], 8000).trim() : '';
      if (content.length === 0) return [];
      const keys = (Array.isArray(e['keys']) ? e['keys'] : [])
        .filter((k): k is string => typeof k === 'string')
        .map((k) => sanitizeText(k, 100).trim())
        .filter((k) => k.length > 0)
        .slice(0, 20);
      const name =
        typeof e['name'] === 'string' ? e['name'] : typeof e['comment'] === 'string' ? e['comment'] : undefined;
      return [
        {
          keys,
          content,
          enabled: e['enabled'] !== false,
          insertionOrder: clampInt(e['insertion_order'], -100000, 100000, 100),
          caseSensitive: e['case_sensitive'] === true,
          constant: e['constant'] === true,
          ...(name !== undefined && name.trim().length > 0 ? { name: sanitizeText(name, 100) } : {}),
        },
      ];
    })
    .slice(0, 200);
  if (entries.length === 0) return undefined;
  return PackLorebookSchema.parse({
    ...(typeof book['name'] === 'string' && book['name'].trim().length > 0
      ? { name: sanitizeText(book['name'], 100) }
      : {}),
    scanDepth: clampInt(book['scan_depth'], 1, 20, 4),
    tokenBudget: clampInt(book['token_budget'], 50, 8000, 1024),
    entries,
  });
}

/** 卡 → 灵魂层（spec §2 映射表）；extensions 等明确丢弃（⑭ 回捡 post_history_instructions → styleAnchor）。 */
export function mapStCardToSoul(card: StCard): StCardSoul {
  const name = card.name.trim();
  const base = [
    card.description.trim(),
    card.personality.trim() ? `## 性格\n${card.personality.trim()}` : '',
    card.scenario.trim() ? `## 场景\n${card.scenario.trim()}` : '',
    card.mes_example.trim()
      ? `## 对话风格示例（模仿语气，不要照抄内容）\n${card.mes_example.replace(/<START>/gi, '').trim()}`
      : '',
  ]
    .filter((s) => s.length > 0)
    .join('\n\n');
  const sys = card.system_prompt.trim();
  let systemPrompt: string;
  if (sys.length > 0) {
    systemPrompt = /\{\{original\}\}/i.test(sys)
      ? sys.replace(/\{\{original\}\}/gi, () => base).trim()
      : `${sys}\n\n${base}`.trim();
  } else {
    systemPrompt = base;
  }
  if (systemPrompt.length === 0) systemPrompt = `你是${name}。`;
  if (systemPrompt.length > 24000) systemPrompt = systemPrompt.slice(0, 24000);
  const greetings = [card.first_mes, ...card.alternate_greetings]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 10);
  const lorebook = mapCharacterBook(card.character_book);
  const description = card.creator_notes.trim().slice(0, 400);
  return {
    name,
    version: card.character_version.trim() || '1.0',
    ...(card.creator.trim() ? { author: card.creator.trim() } : {}),
    ...(description ? { description } : {}),
    ...(card.tags.length > 0 ? { tags: card.tags.slice(0, 20) } : {}),
    persona: {
      systemPrompt,
      beginDialogs: [],
      ...(greetings.length > 0 ? { greetings } : {}),
      ...(card.post_history_instructions.trim()
        ? { styleAnchor: card.post_history_instructions.trim() }
        : {}),
    },
    ...(lorebook ? { lorebook } : {}),
  };
}

function fnv1a36(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** 角色 id：slug(name)，不合法（CJK 等）→ st-<fnv1a base36>（确定性）；冲突 -2 自增。 */
export function pickCharacterId(name: string, exists: (id: string) => boolean): string {
  let slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  if (!CHARACTER_ID_RE.test(slug)) slug = `st-${fnv1a36(name)}`;
  if (!exists(slug)) return slug;
  for (let n = 2; ; n++) {
    const candidate = `${slug}-${n}`;
    if (!exists(candidate)) return candidate;
  }
}
