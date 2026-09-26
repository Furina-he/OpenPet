/**
 * ㉒ 记忆库 v1 → v2 自动升级（spec 2026-09-24-memory-graph-design §5.1 / §5.3；同步、确定性、
 * 零 LLM）。触发：`new MemoryWiki(root)` 之后、任何读写之前；条件 = `.openpet/format.json` 缺失或
 * version < 2。
 *
 * 八步：整目录备份 → frontmatter 转 v2（keys→aliases、补 created、固定页补可读别名；正文不动）→
 * 人物 / 话题按标题改名（冲突保留原名）→ 固定页补导航行 → 存量提及补链（老库一升级就是连通的图，
 * Obsidian 里同样有边）→ 旧 index.md 挪进 `.openpet/` → `.obsidian/` 预设（已存在不碰）→ 写标记。
 * 任一步异常：日志一条、不写标记（下次启动重试）；逐步本身幂等。
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  linkifyMentions,
  memoryFileStem,
  memoryPageKind,
  memoryPageStem,
  parseWikilinks,
  MemoryPageFrontmatterSchema,
  type MemoryLinkPage,
} from '@openpet/protocol';
import {
  FIXED_PAGE_TITLES,
  MACHINE_DIR,
  MemoryWiki,
  pagePaths,
  parseFrontmatter,
  PROFILE_PATH,
  relationshipNav,
  serializePage,
  timelineNav,
} from './memory-wiki.js';

export const MEMORY_FORMAT_VERSION = 2;

export interface UpgradeResult {
  /** 有 v1 内容被升级（调用方据此全量重算页向量）。 */
  upgraded: boolean;
  renamed: Array<[string, string]>;
  /** 存量补链新增的链接数。 */
  linked: number;
  backup?: string;
  error?: string;
}

/** Obsidian 图谱分色（与应用内图谱同色：人物暖 / 话题冷 / 角色紫 / 我 = 品牌色）。 */
const OBSIDIAN_GRAPH_COLORS: Array<[string, number]> = [
  ['path:user/profile', 0xff8fab],
  ['path:user/people', 0xffb4a2],
  ['path:user/topics', 0x7fb7ff],
  ['path:characters', 0xc6a8ff],
];

function formatFile(root: string): string {
  return path.join(root, MACHINE_DIR, 'format.json');
}

export function memoryFormatVersion(root: string): number {
  try {
    const v = (JSON.parse(readFileSync(formatFile(root), 'utf8')) as { version?: unknown }).version;
    return typeof v === 'number' ? v : 0;
  } catch {
    return 0;
  }
}

/** §5.3 前半：`.obsidian/` 不存在时写一次预设，此后归用户。 */
export function writeObsidianPreset(root: string): boolean {
  const dir = path.join(root, '.obsidian');
  if (existsSync(dir)) return false;
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'app.json'),
    JSON.stringify({ useMarkdownLinks: false, newLinkFormat: 'shortest', alwaysUpdateLinks: true }, null, 2),
  );
  writeFileSync(
    path.join(dir, 'graph.json'),
    JSON.stringify(
      {
        colorGroups: OBSIDIAN_GRAPH_COLORS.map(([query, rgb]) => ({ query, color: { a: 1, rgb } })),
      },
      null,
      2,
    ),
  );
  return true;
}

function writeAtomic(file: string, text: string): void {
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return;
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, file);
}

function listMd(root: string, rel: string): string[] {
  const d = path.join(root, rel);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((n) => n.endsWith('.md') && n !== 'index.md')
    .sort()
    .map((n) => `${rel}/${n.normalize('NFC')}`);
}

function characterIds(root: string): string[] {
  const d = path.join(root, 'characters');
  if (!existsSync(d)) return [];
  return readdirSync(d, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(e.name))
    .map((e) => e.name)
    .sort();
}

function allPagePaths(root: string): string[] {
  return [
    PROFILE_PATH,
    ...listMd(root, 'user/people'),
    ...listMd(root, 'user/topics'),
    ...characterIds(root).flatMap((cid) => {
      const pp = pagePaths(cid);
      return [pp.relationship, pp.timeline];
    }),
  ].filter((p) => existsSync(path.join(root, p)));
}

/** 读 + v2 规范化（keys→aliases 由 schema preprocess 完成）；非法页 → null（原样留着）。 */
function readV2(root: string, rel: string) {
  const parsed = parseFrontmatter(readFileSync(path.join(root, rel), 'utf8'));
  if (!parsed) return null;
  const fm = MemoryPageFrontmatterSchema.safeParse(parsed.fm);
  return fm.success ? { fm: fm.data, body: parsed.body } : null;
}

export function upgradeMemoryFormat(
  root: string,
  opts: { now?: () => number; backupRoot?: string; log?: (msg: string) => void } = {},
): UpgradeResult {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((m: string) => console.warn(m));
  const result: UpgradeResult = { upgraded: false, renamed: [], linked: 0 };
  if (memoryFormatVersion(root) >= MEMORY_FORMAT_VERSION) return result;
  try {
    mkdirSync(root, { recursive: true });
    const pages0 = allPagePaths(root);
    if (pages0.length > 0) {
      result.upgraded = true;
      // 1. 整目录备份（跳过 .obsidian——那是用户自己的 Obsidian 配置）
      const backup = path.join(opts.backupRoot ?? path.dirname(root), `memory.bak-v1-${now()}`);
      cpSync(root, backup, {
        recursive: true,
        filter: (src) => path.basename(src) !== '.obsidian',
      });
      result.backup = backup;

      // 2. frontmatter 转 v2（正文不动）
      for (const rel of pages0) {
        const p = readV2(root, rel);
        if (!p) continue;
        const kind = memoryPageKind(rel);
        const fixedTitle =
          kind === 'profile' || kind === 'relationship' || kind === 'timeline'
            ? FIXED_PAGE_TITLES[kind]
            : null;
        const fm = {
          ...p.fm,
          created: p.fm.created ?? p.fm.updated,
          aliases: fixedTitle && p.fm.aliases.length === 0 ? [fixedTitle] : p.fm.aliases,
        };
        writeAtomic(path.join(root, rel), serializePage(fm, p.body));
      }

      // 3. 人物 / 话题按标题改名（同目录大小写不敏感冲突 → 保留原名）
      for (const rel of pages0) {
        const kind = memoryPageKind(rel);
        if (kind !== 'people' && kind !== 'topics') continue;
        const p = readV2(root, rel);
        if (!p) continue;
        const stem = memoryFileStem(p.fm.title);
        if (stem === memoryPageStem(rel)) continue;
        const dir = rel.slice(0, rel.lastIndexOf('/'));
        const to = `${dir}/${stem}.md`;
        const taken = listMd(root, dir).some(
          (o) => o !== rel && o.toLowerCase() === to.toLowerCase(),
        );
        if (taken) continue;
        renameSync(path.join(root, rel), path.join(root, to));
        const prev = path.join(root, `${rel}.prev`);
        if (existsSync(prev)) renameSync(prev, path.join(root, `${to}.prev`));
        result.renamed.push([rel, to]);
      }

      // 4. 固定页导航行（已有则跳过）
      for (const cid of characterIds(root)) {
        const pp = pagePaths(cid);
        for (const [rel, nav] of [
          [pp.relationship, relationshipNav(cid)],
          [pp.timeline, timelineNav(cid)],
        ] as const) {
          if (!existsSync(path.join(root, rel))) continue;
          const p = readV2(root, rel);
          if (!p || p.body.includes(nav)) continue;
          const body = p.body.replace(/^\s+/, '');
          writeAtomic(path.join(root, rel), serializePage(p.fm, body ? `${nav}\n\n${body}` : nav));
        }
      }

      // 5. 存量提及补链（每节首次；锁定节 / code / 自身跳过；幂等）
      const rels = allPagePaths(root);
      const pages = rels
        .map((rel) => ({ rel, p: readV2(root, rel) }))
        .filter((x): x is { rel: string; p: NonNullable<ReturnType<typeof readV2>> } => !!x.p);
      const catalog: MemoryLinkPage[] = pages.map(({ rel, p }) => ({
        path: rel,
        title: p.fm.title,
        aliases: p.fm.aliases,
      }));
      for (const { rel, p } of pages) {
        const body = linkifyMentions(p.body, catalog, { self: rel });
        if (body === p.body) continue;
        result.linked += parseWikilinks(body).length - parseWikilinks(p.body).length;
        writeAtomic(path.join(root, rel), serializePage(p.fm, body));
      }

      // 6. 旧机器索引挪进 .openpet/
      rmSync(path.join(root, 'index.md'), { force: true });
      for (const cid of characterIds(root))
        rmSync(path.join(root, 'characters', cid, 'index.md'), { force: true });
      new MemoryWiki(root, { now }).rebuildIndex();
    }
    // 7. Obsidian 预设（新装与老库都写；已存在不碰）
    writeObsidianPreset(root);
    // 8. 标记
    mkdirSync(path.join(root, MACHINE_DIR), { recursive: true });
    writeFileSync(formatFile(root), JSON.stringify({ version: MEMORY_FORMAT_VERSION }) + '\n');
    return result;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log(`[memory] format upgrade failed (will retry next launch): ${error}`);
    return { ...result, upgraded: false, error };
  }
}
