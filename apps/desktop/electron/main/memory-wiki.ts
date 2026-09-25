/**
 * MemoryWiki —— ⑲ 记忆 v2 文件层（spec §1/§2/§3；纯 Node，无 LLM）+ ㉒ vault v2
 * （spec 2026-09-24-memory-graph-design §1 / §2）。
 *
 * markdown 文件是唯一真源：`userData/memory/`（user/ 跨角色共享 + characters/<id>/ 隔离），
 * 本身就是一个 Obsidian vault。本类负责：目录骨架（固定页带导航行）/ YAML frontmatter
 * （Obsidian Properties；未知键 passthrough 原样写回）/ 六种受控操作 applyOps（护栏 + 锁定节 +
 * 配额 + 整批原子性：任一非法 → 整批丢弃、旧页不动；落盘前链接规范化 + 提及补链；撞名并入）/
 * tmp+rename 原子写 + 单份 .prev / 确定性机器索引（`.openpet/`）/ F3 树与搜索 / 三路注入的两个
 * 只读视图（residentBlocks = 路 1 常驻；projectToLorebook = 路 2 投影成 PackLorebook 复用
 * activateLorebook）——注入视图一律经 toPlainText，LLM 看不到 `[[ ]]`。
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  canonicalName,
  isMemoryPagePath,
  linkifyMentions,
  memoryFileStem,
  memoryLinkName,
  memoryPageKind,
  memoryPageStem,
  normalizeLinks,
  toPlainText,
  MEMORY_LOCKED_MARK,
  MEMORY_PROFILE_SECTIONS,
  MEMORY_QUOTAS,
  MEMORY_RELATIONSHIP_SECTIONS,
  MemoryPageSchema,
  type MemoryLinkPage,
  type MemoryOp,
  type MemoryPage,
  type MemoryPageFrontmatter,
  type MemoryTree,
  type MemoryTreeNode,
  type PackLorebook,
} from '@openpet/protocol';

/** 非法操作（护栏/配额/锁定节）；message 进 memory.status.lastCompile.error。 */
export class MemoryOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryOpError';
  }
}

export interface MemoryWikiOptions {
  now?: () => number;
}

interface Section {
  name: string;
  body: string;
}
interface ParsedBody {
  preamble: string;
  sections: Section[];
}
/** 无标题页（create_page 自由正文）的隐式节名：upsert_section/remove_line 用它定位全文。 */
export const IMPLICIT_SECTION = '正文';
/** 机器索引 / 格式标记目录（Obsidian 不索引 `.` 开头目录）。 */
export const MACHINE_DIR = '.openpet';

// ---------- markdown 工具（导出供 renderer 纯逻辑 / 测试复用）----------

export function localDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 解析 `---` 包裹的 YAML frontmatter（Obsidian 块列表 / v1 的 JSON 风格值都是合法 YAML）；
 * 无 frontmatter / YAML 非法 / 顶层不是映射 → null。
 */
export function parseFrontmatter(
  raw: string,
): { fm: Record<string, unknown>; body: string } | null {
  const text = raw.replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n?---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return null;
  let fm: unknown;
  try {
    fm = m[1]!.trim() ? parseYaml(m[1]!) : {};
  } catch {
    return null;
  }
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) return null;
  const rest = text.slice(m[0].length);
  return { fm: fm as Record<string, unknown>, body: rest.startsWith('\n') ? rest.slice(1) : rest };
}

const FM_ORDER = ['title', 'aliases', 'tags', 'summary', 'created', 'updated', 'source'] as const;

/** 键序：title, aliases, tags, summary, created, updated, source, 其余按原序；列表块样式。 */
export function serializePage(fm: MemoryPageFrontmatter, body: string): string {
  const ordered: Record<string, unknown> = {};
  const rec = fm as Record<string, unknown>;
  for (const k of FM_ORDER) if (rec[k] !== undefined) ordered[k] = rec[k];
  for (const [k, v] of Object.entries(rec))
    if (!(FM_ORDER as readonly string[]).includes(k) && v !== undefined) ordered[k] = v;
  const yaml = stringifyYaml(ordered, { lineWidth: 0 });
  return `---\n${yaml}---\n\n${body.replace(/\r\n/g, '\n').replace(/\s+$/, '')}\n`;
}

/** 按 `## 标题` 切节；无任何标题 → 单隐式节「正文」。 */
export function splitSections(body: string): ParsedBody {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const sections: Section[] = [];
  let preamble: string[] = [];
  let cur: { name: string; lines: string[] } | null = null;
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (cur) sections.push({ name: cur.name, body: cur.lines.join('\n').trim() });
      cur = { name: m[1]!, lines: [] };
    } else if (cur) cur.lines.push(line);
    else preamble.push(line);
  }
  if (cur) sections.push({ name: cur.name, body: cur.lines.join('\n').trim() });
  if (sections.length === 0) {
    const whole = preamble.join('\n').trim();
    preamble = [];
    return { preamble: '', sections: [{ name: IMPLICIT_SECTION, body: whole }] };
  }
  return { preamble: preamble.join('\n').trim(), sections };
}

export function joinSections(parsed: ParsedBody): string {
  if (parsed.sections.length === 1 && parsed.sections[0]!.name === IMPLICIT_SECTION) {
    return parsed.sections[0]!.body;
  }
  const parts: string[] = [];
  if (parsed.preamble) parts.push(parsed.preamble);
  for (const s of parsed.sections) parts.push(`## ${s.name}\n\n${s.body}`.trimEnd());
  return parts.join('\n\n');
}

export function isLocked(sectionBody: string): boolean {
  return sectionBody.trimStart().startsWith(MEMORY_LOCKED_MARK);
}

const TIMELINE_ENTRY_RE = /^-\s+(\d{4}-\d{2}-\d{2})\s*(.*)$/;
const byDateDesc = (a: { date: string }, b: { date: string }): number =>
  a.date < b.date ? 1 : a.date > b.date ? -1 : 0;

/** timeline 条目：`- YYYY-MM-DD text` 行；返回按日期倒序。 */
export function parseTimeline(body: string): Array<{ date: string; text: string }> {
  const out: Array<{ date: string; text: string }> = [];
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const m = TIMELINE_ENTRY_RE.exec(line.trim());
    if (m) out.push({ date: m[1]!, text: m[2]! });
  }
  return out.sort(byDateDesc);
}

export function serializeTimeline(entries: Array<{ date: string; text: string }>): string {
  return entries.map((e) => `- ${e.date} ${e.text}`).join('\n');
}

/** ㉒ timeline =「前言（导航行等，编译器不可改）+ 条目」两段式。 */
export function splitTimeline(body: string): {
  preamble: string;
  entries: Array<{ date: string; text: string }>;
} {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const idx = lines.findIndex((l) => TIMELINE_ENTRY_RE.test(l.trim()));
  const preamble = (idx < 0 ? lines : lines.slice(0, idx)).join('\n').trim();
  return { preamble, entries: idx < 0 ? [] : parseTimeline(lines.slice(idx).join('\n')) };
}

export function joinTimeline(
  preamble: string,
  entries: Array<{ date: string; text: string }>,
): string {
  return [preamble, serializeTimeline([...entries].sort(byDateDesc))].filter(Boolean).join('\n\n');
}

// ---------- 骨架 ----------

function skeleton(sections: readonly string[]): string {
  return sections.map((s) => `## ${s}\n`).join('\n');
}

export function pagePaths(characterId: string): { relationship: string; timeline: string } {
  return {
    relationship: `characters/${characterId}/relationship.md`,
    timeline: `characters/${characterId}/timeline.md`,
  };
}
export const PROFILE_PATH = 'user/profile.md';

/** 固定页可读名（= aliases；Obsidian 图谱只显示文件名，应用内图谱用它）。 */
export const FIXED_PAGE_TITLES = {
  profile: '用户档案',
  relationship: '我们的关系',
  timeline: '共同经历',
} as const;

/** §1.5 固定页导航行（结构边：关系—经历挂在用户档案上，档案是图谱中心）。 */
export function relationshipNav(characterId: string): string {
  return `> [[profile|${FIXED_PAGE_TITLES.profile}]] · [[characters/${characterId}/timeline|${FIXED_PAGE_TITLES.timeline}]]`;
}
export function timelineNav(characterId: string): string {
  return `> [[characters/${characterId}/relationship|${FIXED_PAGE_TITLES.relationship}]]`;
}

function linkMeta(p: MemoryPage): MemoryLinkPage {
  return { path: p.path, title: p.frontmatter.title, aliases: p.frontmatter.aliases };
}

/** 按规范化名去重（保留首见写法），可选排除与 `exclude` 同名的项。 */
function uniqNames(names: readonly string[], exclude?: string): string[] {
  const seen = new Set<string>(exclude ? [canonicalName(exclude)] : []);
  const out: string[] = [];
  for (const n of names) {
    const c = canonicalName(n);
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(n.trim());
  }
  return out;
}

// ---------- MemoryWiki ----------

export class MemoryWiki {
  private readonly now: () => number;

  constructor(
    readonly root: string,
    opts: MemoryWikiOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
  }

  private abs(rel: string): string {
    if (!isMemoryPagePath(rel)) throw new MemoryOpError(`非法页面路径：${rel}`);
    return path.join(this.root, rel);
  }

  today(): string {
    return localDate(this.now());
  }

  /** 建目录 + profile 固定节骨架 + 本角色 relationship/timeline 空页（幂等；带导航行）。 */
  ensureLayout(characterId: string): void {
    mkdirSync(path.join(this.root, 'user', 'people'), { recursive: true });
    mkdirSync(path.join(this.root, 'user', 'topics'), { recursive: true });
    mkdirSync(path.join(this.root, 'characters', characterId), { recursive: true });
    const today = this.today();
    const fixed = (
      rel: string,
      title: string,
      summary: string,
      body: string,
    ): void => {
      if (this.exists(rel)) return;
      this.writePageRaw(
        {
          path: rel,
          frontmatter: {
            title,
            aliases: [title],
            tags: [],
            summary,
            created: today,
            updated: today,
            source: 'llm',
          },
          body,
        },
        false,
      );
    };
    fixed(
      PROFILE_PATH,
      FIXED_PAGE_TITLES.profile,
      '关于用户的长期档案',
      skeleton(MEMORY_PROFILE_SECTIONS),
    );
    const pp = pagePaths(characterId);
    fixed(
      pp.relationship,
      FIXED_PAGE_TITLES.relationship,
      '与用户的关系叙事',
      `${relationshipNav(characterId)}\n\n${skeleton(MEMORY_RELATIONSHIP_SECTIONS)}`,
    );
    fixed(pp.timeline, FIXED_PAGE_TITLES.timeline, '与用户的共同经历（倒序）', timelineNav(characterId));
    this.rebuildIndex();
  }

  hasCharacter(characterId: string): boolean {
    return existsSync(path.join(this.root, 'characters', characterId));
  }

  exists(rel: string): boolean {
    return existsSync(this.abs(rel));
  }

  readRaw(rel: string): string | null {
    const f = this.abs(rel);
    return existsSync(f) ? readFileSync(f, 'utf8') : null;
  }

  /** 解析 + Zod 校验；文件缺失 / frontmatter 非法 → null。 */
  readPage(rel: string): MemoryPage | null {
    const raw = this.readRaw(rel);
    if (raw === null) return null;
    return this.parsePage(rel, raw);
  }

  parsePage(rel: string, raw: string): MemoryPage | null {
    const parsed = parseFrontmatter(raw);
    if (!parsed) return null;
    const page = MemoryPageSchema.safeParse({ path: rel, frontmatter: parsed.fm, body: parsed.body });
    return page.success ? page.data : null;
  }

  /** 原子写（tmp + rename）+ 单份 .prev（覆盖旧份）。默认写后重建索引。 */
  writePage(page: MemoryPage): void {
    this.writePageRaw(page, true);
  }

  private writePageRaw(page: MemoryPage, reindex: boolean): void {
    const f = this.abs(page.path);
    mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.tmp`;
    writeFileSync(tmp, serializePage(page.frontmatter, page.body), 'utf8');
    if (existsSync(f)) renameSync(f, `${f}.prev`);
    renameSync(tmp, f);
    if (reindex) this.rebuildIndex();
  }

  /**
   * 用户侧保存：raw 全文 → 校验 → source:user + updated=today → 链接规范化（只做别名→文件名；
   * 悬空链接保留 = Obsidian 语义，不替用户补链）→ 原子写。非法抛 MemoryOpError。
   */
  writeRaw(rel: string, raw: string): MemoryPage {
    const parsed = parseFrontmatter(raw);
    if (!parsed)
      throw new MemoryOpError('缺少 frontmatter（--- 包裹的 YAML：title / aliases / tags / summary …）');
    const today = this.today();
    const page = MemoryPageSchema.safeParse({
      path: rel,
      frontmatter: { created: today, ...parsed.fm, source: 'user', updated: today },
      body: parsed.body,
    });
    if (!page.success)
      throw new MemoryOpError(`页面非法：${page.error.issues[0]?.message ?? ''}`);
    const catalog = [
      ...this.listAllPages()
        .filter((p) => p.path !== rel)
        .map(linkMeta),
      linkMeta(page.data),
    ];
    const next: MemoryPage = {
      ...page.data,
      body: normalizeLinks(page.data.body, catalog, { dropUnresolved: false, from: rel }),
    };
    this.writePage(next);
    return next;
  }

  /** people/topics 删除文件；固定页重置为骨架。 */
  deletePage(rel: string, characterId: string): void {
    const kind = memoryPageKind(rel);
    const f = this.abs(rel);
    if (kind === 'people' || kind === 'topics') {
      rmSync(f, { force: true });
      rmSync(`${f}.prev`, { force: true });
      this.rebuildIndex();
      return;
    }
    rmSync(f, { force: true });
    this.ensureLayout(characterId);
  }

  /** 清空：本角色目录 + 共享 user/（用户明确 ③ 级确认后）。 */
  clear(characterId: string): void {
    rmSync(path.join(this.root, 'characters', characterId), { recursive: true, force: true });
    rmSync(path.join(this.root, 'user'), { recursive: true, force: true });
    this.ensureLayout(characterId);
  }

  /** 目录下合法的 `.md` 页路径（不合法的文件名——如 Obsidian 里手建的怪名——跳过）。 */
  listDir(relDir: string): string[] {
    const d = path.join(this.root, relDir);
    if (!existsSync(d)) return [];
    return readdirSync(d)
      .filter((n) => n.endsWith('.md'))
      .map((n) => `${relDir}/${n.normalize('NFC')}`)
      .filter(isMemoryPagePath)
      .sort();
  }

  /** 全部可注入页（user/* + 本角色两页）；解析失败的页跳过。 */
  listPages(characterId: string): MemoryPage[] {
    const rels = [
      PROFILE_PATH,
      ...this.listDir('user/people'),
      ...this.listDir('user/topics'),
      pagePaths(characterId).relationship,
      pagePaths(characterId).timeline,
    ];
    return this.readAll(rels);
  }

  /** 全库页（含全部角色的关系 / 经历）：链接目录 / 图谱 all 范围 / 重命名改写用。 */
  listAllPages(): MemoryPage[] {
    const rels = [
      PROFILE_PATH,
      ...this.listDir('user/people'),
      ...this.listDir('user/topics'),
      ...this.listAllCharacterIds().flatMap((cid) => {
        const pp = pagePaths(cid);
        return [pp.relationship, pp.timeline];
      }),
    ];
    return this.readAll(rels);
  }

  private readAll(rels: readonly string[]): MemoryPage[] {
    const out: MemoryPage[] = [];
    for (const r of rels) {
      const p = this.readPage(r);
      if (p) out.push(p);
    }
    return out;
  }

  listAllCharacterIds(): string[] {
    const d = path.join(this.root, 'characters');
    if (!existsSync(d)) return [];
    return readdirSync(d, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(e.name))
      .map((e) => e.name)
      .sort();
  }

  // ---------- applyOps ----------

  /**
   * 六种操作（⑲ §3 + ㉒ §2.2）。先在内存里全部校验并算出新页，再统一落盘——第 N 个非法则前 N-1 个
   * 不落盘。LLM 写入的文本落盘前两遍规范化（§2.3）：链接目录 = 现有页 ∪ 本批新建（撞名并入的名字
   * 挂到目标页别名上）→ 别名写法改文件名 / 悬空降纯文本 → 提及补链。
   * 返回变更页路径（去重）与撞名并入记录。
   */
  applyOps(
    ops: readonly MemoryOp[],
    characterId: string,
  ): { changed: string[]; merged: Array<[string, string]> } {
    if (ops.length > MEMORY_QUOTAS.opsPerBatch) throw new MemoryOpError('操作数超上限');
    const pp = pagePaths(characterId);
    const today = this.today();
    /** 工作副本：path → page（首次触碰时从盘读）。 */
    const work = new Map<string, MemoryPage>();
    const load = (rel: string): MemoryPage => {
      const w = work.get(rel);
      if (w) return w;
      const p = this.readPage(rel);
      if (!p) throw new MemoryOpError(`页面不存在：${rel}`);
      work.set(rel, p);
      return p;
    };
    const guardPage = (rel: string): void => {
      if (rel.startsWith('characters/') && !rel.startsWith(`characters/${characterId}/`))
        throw new MemoryOpError(`不可操作其他角色页面：${rel}`);
    };
    const touchedSections = new Set<string>();
    const dedupe = (rel: string, section: string): void => {
      const k = `${rel}#${section}`;
      if (touchedSections.has(k)) throw new MemoryOpError(`同批重复操作同页同节：${k}`);
      touchedSections.add(k);
    };
    const quotaOf = (rel: string): number =>
      memoryPageKind(rel) === 'profile' ? MEMORY_QUOTAS.profileChars : MEMORY_QUOTAS.pageChars;
    const checkQuota = (page: MemoryPage): void => {
      if (page.body.length > quotaOf(page.path))
        throw new MemoryOpError(
          `页面超配额（${page.path} ${page.body.length} > ${quotaOf(page.path)}）`,
        );
    };
    const bump = (rel: string, page: MemoryPage): void => {
      work.set(rel, {
        ...page,
        frontmatter: { ...page.frontmatter, updated: today, source: 'llm' },
      });
    };

    // 第一遍：链接目录 + create_page 去向（新建 / 撞名并入）
    const catalog = new Map<string, { path: string; title: string; aliases: string[] }>(
      this.listAllPages().map((p) => [
        p.path,
        { path: p.path, title: p.frontmatter.title, aliases: [...p.frontmatter.aliases] },
      ]),
    );
    const createPlan = new Map<MemoryOp, { path: string; merge: boolean }>();
    for (const op of ops) {
      if (op.op !== 'create_page') continue;
      const target = sameNamePage(op.kind, [op.title, ...op.aliases], [...catalog.values()]);
      if (target) {
        createPlan.set(op, { path: target, merge: true });
        catalog.get(target)!.aliases.push(op.title, ...op.aliases);
      } else {
        const rel = `user/${op.kind}/${memoryFileStem(op.title)}.md`;
        createPlan.set(op, { path: rel, merge: false });
        if (!catalog.has(rel))
          catalog.set(rel, { path: rel, title: op.title, aliases: [...op.aliases] });
      }
    }
    const linkPages = (): MemoryLinkPage[] => [...catalog.values()];
    /** LLM 写入文本规范化：别名 → 文件名、悬空降纯文本、提及补链（不链自身）。 */
    const norm = (text: string, from: string): string => {
      const pages = linkPages();
      return linkifyMentions(normalizeLinks(text, pages, { dropUnresolved: true, from }), pages, {
        self: from,
      });
    };
    const createdCount = { people: 0, topics: 0 };
    const merged: Array<[string, string]> = [];

    for (const op of ops) {
      switch (op.op) {
        case 'upsert_section': {
          guardPage(op.page);
          if (memoryPageKind(op.page) === 'timeline')
            throw new MemoryOpError('timeline 只能 append/merge');
          if (op.content.includes(MEMORY_LOCKED_MARK))
            throw new MemoryOpError('LLM 不得写入锁定标记');
          dedupe(op.page, op.section);
          const page = load(op.page);
          const parsed = splitSections(page.body);
          const sec = parsed.sections.find((s) => s.name === op.section);
          if (!sec) throw new MemoryOpError(`节不存在：${op.page}#${op.section}`);
          if (isLocked(sec.body)) throw new MemoryOpError(`节已锁定：${op.page}#${op.section}`);
          sec.body = norm(op.content.trim(), op.page);
          const next = { ...page, body: joinSections(parsed) };
          checkQuota(next);
          bump(op.page, next);
          break;
        }
        case 'remove_line': {
          guardPage(op.page);
          if (memoryPageKind(op.page) === 'timeline')
            throw new MemoryOpError('timeline 只能 append/merge');
          dedupe(op.page, op.section);
          const page = load(op.page);
          const parsed = splitSections(page.body);
          const sec = parsed.sections.find((s) => s.name === op.section);
          if (!sec) throw new MemoryOpError(`节不存在：${op.page}#${op.section}`);
          if (isLocked(sec.body)) throw new MemoryOpError(`节已锁定：${op.page}#${op.section}`);
          const lines = sec.body.split('\n');
          const kept = lines.filter((l) => !l.includes(op.match));
          if (kept.length === lines.length)
            throw new MemoryOpError(`remove_line 无匹配行：${op.match}`);
          sec.body = kept.join('\n').trim();
          bump(op.page, { ...page, body: joinSections(parsed) });
          break;
        }
        case 'create_page': {
          if (op.content.includes(MEMORY_LOCKED_MARK))
            throw new MemoryOpError('LLM 不得写入锁定标记');
          const plan = createPlan.get(op)!;
          if (plan.merge) {
            // 撞名并入（§2.2，防重复人物）：正文追加新段落、aliases / tags 取并集
            const page = load(plan.path);
            const parsed = splitSections(page.body);
            const lastSec = parsed.sections[parsed.sections.length - 1];
            if (lastSec && isLocked(lastSec.body))
              throw new MemoryOpError(`节已锁定：${plan.path}#${lastSec.name}`);
            const add = norm(op.content.trim(), plan.path);
            const fm = page.frontmatter;
            const next: MemoryPage = {
              ...page,
              frontmatter: {
                ...fm,
                aliases: uniqNames([...fm.aliases, op.title, ...op.aliases], fm.title).slice(0, 20),
                tags: [...new Set([...fm.tags, ...op.tags])].slice(0, 12),
              },
              body: [page.body.trimEnd(), add].filter(Boolean).join('\n\n'),
            };
            checkQuota(next);
            bump(plan.path, next);
            merged.push([op.title, plan.path]);
            break;
          }
          const rel = plan.path;
          if (work.has(rel) || this.existsCaseInsensitive(rel))
            throw new MemoryOpError(`页面已存在：${rel}`);
          const existing = this.listDir(`user/${op.kind}`).length + createdCount[op.kind];
          if (existing >= MEMORY_QUOTAS.pagesPerKind)
            throw new MemoryOpError(`${op.kind} 页数超配额`);
          createdCount[op.kind]++;
          const body = norm(op.content.trim(), rel);
          const firstLine =
            toPlainText(body)
              .split('\n')
              .find((l) => l.trim())
              ?.trim() ?? '';
          const page: MemoryPage = {
            path: rel,
            frontmatter: {
              title: op.title,
              aliases: uniqNames(op.aliases, op.title),
              tags: [...new Set(op.tags)],
              summary: firstLine.replace(/^[-#*>\s]+/, '').slice(0, 120),
              created: today,
              updated: today,
              source: 'llm',
            },
            body,
          };
          checkQuota(page);
          work.set(rel, page);
          break;
        }
        case 'set_props': {
          guardPage(op.page);
          dedupe(op.page, '@props');
          const page = load(op.page);
          bump(op.page, {
            ...page,
            frontmatter: {
              ...page.frontmatter,
              ...(op.aliases ? { aliases: uniqNames(op.aliases) } : {}),
              ...(op.tags ? { tags: [...new Set(op.tags)] } : {}),
              ...(op.summary !== undefined ? { summary: op.summary } : {}),
            },
          });
          break;
        }
        case 'append_timeline': {
          const page = load(pp.timeline);
          const { preamble, entries } = splitTimeline(page.body);
          if (entries.length >= MEMORY_QUOTAS.timelineEntries)
            throw new MemoryOpError('timeline 条目超配额，须先 merge_timeline');
          // 日期夹紧：晚于今天记为今天（模型日期错乱时不整批拒）
          const date = op.date > today ? today : op.date;
          entries.push({ date, text: norm(op.text, pp.timeline).replace(/\s+/g, ' ').trim() });
          bump(pp.timeline, { ...page, body: joinTimeline(preamble, entries) });
          break;
        }
        case 'merge_timeline': {
          const page = load(pp.timeline);
          const { preamble, entries } = splitTimeline(page.body);
          const old = entries.filter((e) => e.date < op.before);
          if (old.length === 0)
            throw new MemoryOpError(`merge_timeline 无可合并条目（< ${op.before}）`);
          const keep = entries.filter((e) => e.date >= op.before);
          keep.push({
            date: op.before,
            text: `（此前合并）${norm(op.text, pp.timeline).replace(/\s+/g, ' ').trim()}`,
          });
          bump(pp.timeline, { ...page, body: joinTimeline(preamble, keep) });
          break;
        }
      }
    }

    const changed = [...work.keys()];
    for (const rel of changed) this.writePageRaw(work.get(rel)!, false);
    if (changed.length > 0) this.rebuildIndex();
    return { changed, merged };
  }

  /** 同目录大小写不敏感查重（Windows 文件系统口径；其他平台同样拒）。 */
  private existsCaseInsensitive(rel: string): boolean {
    if (this.exists(rel)) return true;
    const dir = rel.slice(0, rel.lastIndexOf('/'));
    const want = rel.toLowerCase();
    return this.listDir(dir).some((p) => p.toLowerCase() === want);
  }

  // ---------- 索引 / 树 / 搜索 ----------

  private indexLine(p: MemoryPage, catalog: readonly MemoryLinkPage[]): string {
    const label = { profile: '档案', people: '人物', topics: '话题', relationship: '关系', timeline: '经历' }[
      memoryPageKind(p.path)
    ];
    const fm = p.frontmatter;
    const aliases = fm.aliases.filter((a) => canonicalName(a) !== canonicalName(fm.title));
    return [
      `- [[${memoryLinkName(p.path, catalog)}]]（${label}）— ${fm.summary}`,
      aliases.length ? ` · 别名：${aliases.join('、')}` : '',
      fm.tags.length ? ` · 标签：${fm.tags.join('、')}` : '',
    ].join('');
  }

  /**
   * 确定性输出（同内容 → 逐字节相等）：`.openpet/index.md`（全局）+
   * `.openpet/characters/<id>/index.md`（每角色，编译器输入）。
   */
  rebuildIndex(): void {
    const all = this.listAllPages();
    const catalog = all.map(linkMeta);
    const userPages = all.filter((p) => p.path.startsWith('user/'));
    const cids = this.listAllCharacterIds();
    const charPages = (cid: string): MemoryPage[] =>
      all.filter((p) => p.path.startsWith(`characters/${cid}/`));
    const line = (p: MemoryPage): string => this.indexLine(p, catalog);
    const userBlock = ['# 记忆索引', '', '## 用户', ...userPages.map(line)];
    const global = [...userBlock];
    for (const cid of cids) global.push('', `## 角色 ${cid}`, ...charPages(cid).map(line));
    this.writeText(path.join(this.root, MACHINE_DIR, 'index.md'), global.join('\n') + '\n');
    for (const cid of cids) {
      const lines = [...userBlock, '', '## 本角色', ...charPages(cid).map(line)];
      this.writeText(
        path.join(this.root, MACHINE_DIR, 'characters', cid, 'index.md'),
        lines.join('\n') + '\n',
      );
    }
  }

  private writeText(file: string, text: string): void {
    mkdirSync(path.dirname(file), { recursive: true });
    if (existsSync(file) && readFileSync(file, 'utf8') === text) return;
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, file);
  }

  readIndex(characterId: string): string {
    const f = path.join(this.root, MACHINE_DIR, 'characters', characterId, 'index.md');
    return existsSync(f) ? readFileSync(f, 'utf8') : '';
  }

  private node(p: MemoryPage): MemoryTreeNode {
    return {
      path: p.path,
      title: p.frontmatter.title,
      summary: p.frontmatter.summary,
      updated: p.frontmatter.updated,
      source: p.frontmatter.source,
      aliases: p.frontmatter.aliases,
      tags: p.frontmatter.tags,
    };
  }

  tree(characterId: string): MemoryTree {
    this.ensureLayout(characterId);
    const pp = pagePaths(characterId);
    // 固定页损坏（如在 Obsidian 里把 YAML 改坏）不抛：占位节点，F3 标红可在编辑器修复
    const fixed = (rel: string, title: string): MemoryTreeNode => {
      const p = this.readPage(rel);
      if (p) return this.node(p);
      return {
        path: rel,
        title,
        summary: '',
        updated: '',
        source: 'user',
        aliases: [],
        tags: [],
        broken: true,
      };
    };
    const nodes = (dir: string): MemoryTreeNode[] =>
      this.readAll(this.listDir(dir)).map((p) => this.node(p));
    return {
      profile: fixed(PROFILE_PATH, FIXED_PAGE_TITLES.profile),
      people: nodes('user/people'),
      topics: nodes('user/topics'),
      relationship: fixed(pp.relationship, FIXED_PAGE_TITLES.relationship),
      timeline: fixed(pp.timeline, FIXED_PAGE_TITLES.timeline),
    };
  }

  search(q: string, characterId: string): Array<{ path: string; title: string; snippet: string }> {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const hits: Array<{ path: string; title: string; snippet: string }> = [];
    for (const p of this.listPages(characterId)) {
      const fm = p.frontmatter;
      const inMeta = [fm.title, ...fm.aliases, ...fm.tags].some((k) =>
        k.toLowerCase().includes(needle),
      );
      const line = p.body.split('\n').find((l) => l.toLowerCase().includes(needle));
      if (!inMeta && line === undefined) continue;
      const snippet = toPlainText(line ?? fm.summary)
        .trim()
        .slice(0, 120);
      hits.push({ path: p.path, title: fm.title, snippet });
    }
    return hits;
  }

  pageCount(characterId: string): number {
    return this.listPages(characterId).length;
  }

  /** 页级向量索引输入：path + 内容 hash（变更检测）+ 嵌入文本（纯文本投影）。 */
  pagesForIndex(characterId: string): Array<{ path: string; hash: string; text: string }> {
    return this.listPages(characterId).map((p) => {
      const text = `${p.frontmatter.title}\n${p.frontmatter.aliases.join(' ')}\n${toPlainText(p.body)}`;
      return { path: p.path, hash: createHash('sha1').update(text).digest('hex'), text };
    });
  }

  // ---------- 三路注入视图（一律纯文本投影）----------

  /** 路 1 常驻：profile「一句话档案」(≤600) + relationship 全文(≤400) + timeline 最近 3 条。 */
  residentBlocks(characterId: string): string[] {
    const out: string[] = [];
    const profile = this.readPage(PROFILE_PATH);
    if (profile) {
      const sec = splitSections(profile.body).sections.find(
        (s) => s.name === MEMORY_PROFILE_SECTIONS[0],
      );
      const text = toPlainText(stripLock(sec?.body ?? '')).trim();
      if (text) out.push(`### 用户档案\n${text.slice(0, MEMORY_QUOTAS.residentProfileChars)}`);
    }
    const pp = pagePaths(characterId);
    const rel = this.readPage(pp.relationship);
    if (rel) {
      const parsed = splitSections(rel.body);
      const nonEmpty = parsed.sections.filter((s) => stripLock(s.body));
      if (nonEmpty.length) {
        const text = toPlainText(
          nonEmpty.map((s) => `${s.name}：${stripLock(s.body)}`).join('\n'),
        );
        out.push(`### 我们的关系\n${text.slice(0, MEMORY_QUOTAS.residentRelationshipChars)}`);
      }
    }
    const tl = this.readPage(pp.timeline);
    if (tl) {
      const recent = parseTimeline(tl.body).slice(0, MEMORY_QUOTAS.residentTimelineEntries);
      if (recent.length) out.push(`### 最近经历\n${toPlainText(serializeTimeline(recent))}`);
    }
    return out;
  }

  /**
   * 路 2 投影：people/topics 每页一条 entry（keys = aliases ∪ title ∪ 文件名；updated 倒序；
   * content 纯文本；name = 页路径）。
   */
  projectToLorebook(characterId: string): PackLorebook {
    const pages = this.listPages(characterId).filter((p) => {
      const k = memoryPageKind(p.path);
      return k === 'people' || k === 'topics';
    });
    const sorted = [...pages].sort((a, b) =>
      a.frontmatter.updated < b.frontmatter.updated
        ? 1
        : a.frontmatter.updated > b.frontmatter.updated
          ? -1
          : 0,
    );
    return {
      scanDepth: MEMORY_QUOTAS.keywordScanDepth,
      tokenBudget: MEMORY_QUOTAS.keywordTokenBudget,
      entries: sorted
        .filter((p) => p.body.trim().length > 0)
        .map((p, i) => ({
          keys: [
            ...new Set([...p.frontmatter.aliases, p.frontmatter.title, memoryPageStem(p.path)]),
          ].slice(0, 20),
          content: `### ${p.frontmatter.title}\n${toPlainText(p.body).slice(0, 8000)}`,
          enabled: true,
          insertionOrder: i,
          caseSensitive: false,
          constant: false,
          name: p.path,
        })),
    };
  }
}

/** 撞名判定（§2.2）：同类已有页的标题 / 别名 / 文件名与任一候选名规范化后相同 → 该页路径。 */
function sameNamePage(
  kind: 'people' | 'topics',
  names: readonly string[],
  pages: readonly MemoryLinkPage[],
): string | null {
  const want = new Set(names.map(canonicalName).filter(Boolean));
  for (const p of pages) {
    if (memoryPageKind(p.path) !== kind) continue;
    const have = [p.title, ...p.aliases, memoryPageStem(p.path)].map(canonicalName);
    if (have.some((h) => want.has(h))) return p.path;
  }
  return null;
}

function stripLock(body: string): string {
  return body.replace(MEMORY_LOCKED_MARK, '').trim();
}
