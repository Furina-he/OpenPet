/**
 * MemoryWiki —— ⑲ 记忆 v2 文件层（spec §1/§2/§3；纯 Node，无 LLM）。
 *
 * markdown 文件是唯一真源：`userData/memory/`（user/ 跨角色共享 + characters/<id>/ 隔离）。
 * 本类负责：目录骨架 / frontmatter 解析序列化（自研 ~40 行，不引 gray-matter）/ 五种受控
 * 操作 applyOps（护栏 + 锁定节 + 配额 + 整批原子性：任一非法 → 整批丢弃、旧页不动）/
 * tmp+rename 原子写 + 单份 .prev / 确定性 index.md / F3 树与搜索 / 三路注入的两个只读视图
 * （residentBlocks = 路 1 常驻；projectToLorebook = 路 2 投影成 PackLorebook 复用 activateLorebook）。
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
import {
  MEMORY_LOCKED_MARK,
  MEMORY_PAGE_PATH_RE,
  MEMORY_PROFILE_SECTIONS,
  MEMORY_QUOTAS,
  MEMORY_RELATIONSHIP_SECTIONS,
  MemoryPageFrontmatterSchema,
  MemoryPageSchema,
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

// ---------- markdown 工具（导出供 renderer 纯逻辑 / 测试复用）----------

export function localDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 解析 `---` 包裹的 frontmatter（key: value 行；keys 用 JSON 数组）；无 frontmatter → null。 */
export function parseFrontmatter(
  raw: string,
): { fm: Record<string, unknown>; body: string } | null {
  const text = raw.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (end < 0) return null;
  const block = text.slice(4, end);
  const rest = text.slice(end + 4);
  const body = rest.startsWith('\n') ? rest.slice(1) : rest;
  const fm: Record<string, unknown> = {};
  for (const line of block.split('\n')) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    const val = m[2]!.trim();
    if (val.startsWith('[') || val.startsWith('"')) {
      try {
        fm[key] = JSON.parse(val);
        continue;
      } catch {
        /* 退回裸字符串 */
      }
    }
    fm[key] = val;
  }
  return { fm, body };
}

export function serializePage(fm: MemoryPageFrontmatter, body: string): string {
  const lines = [
    '---',
    `title: ${JSON.stringify(fm.title)}`,
    `keys: ${JSON.stringify(fm.keys)}`,
    `summary: ${JSON.stringify(fm.summary)}`,
    `updated: ${fm.updated}`,
    `source: ${fm.source}`,
    '---',
    '',
  ];
  return lines.join('\n') + body.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
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

/** timeline 条目：`- YYYY-MM-DD text` 行；返回按日期倒序。 */
export function parseTimeline(body: string): Array<{ date: string; text: string }> {
  const out: Array<{ date: string; text: string }> = [];
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const m = /^-\s+(\d{4}-\d{2}-\d{2})\s*(.*)$/.exec(line.trim());
    if (m) out.push({ date: m[1]!, text: m[2]! });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function serializeTimeline(entries: Array<{ date: string; text: string }>): string {
  return entries.map((e) => `- ${e.date} ${e.text}`).join('\n');
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

function kindOf(p: string): 'profile' | 'people' | 'topics' | 'relationship' | 'timeline' {
  if (p === PROFILE_PATH) return 'profile';
  if (p.startsWith('user/people/')) return 'people';
  if (p.startsWith('user/topics/')) return 'topics';
  return p.endsWith('/timeline.md') ? 'timeline' : 'relationship';
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
    if (!MEMORY_PAGE_PATH_RE.test(rel)) throw new MemoryOpError(`非法页面路径：${rel}`);
    return path.join(this.root, rel);
  }

  today(): string {
    return localDate(this.now());
  }

  /** 建目录 + profile 固定节骨架 + 本角色 relationship/timeline 空页（幂等）。 */
  ensureLayout(characterId: string): void {
    mkdirSync(path.join(this.root, 'user', 'people'), { recursive: true });
    mkdirSync(path.join(this.root, 'user', 'topics'), { recursive: true });
    mkdirSync(path.join(this.root, 'characters', characterId), { recursive: true });
    const today = this.today();
    if (!this.exists(PROFILE_PATH)) {
      this.writePageRaw(
        {
          path: PROFILE_PATH,
          frontmatter: {
            title: '用户档案',
            keys: [],
            summary: '关于用户的长期档案',
            updated: today,
            source: 'llm',
          },
          body: skeleton(MEMORY_PROFILE_SECTIONS),
        },
        false,
      );
    }
    const pp = pagePaths(characterId);
    if (!this.exists(pp.relationship)) {
      this.writePageRaw(
        {
          path: pp.relationship,
          frontmatter: {
            title: '我们的关系',
            keys: [],
            summary: '与用户的关系叙事',
            updated: today,
            source: 'llm',
          },
          body: skeleton(MEMORY_RELATIONSHIP_SECTIONS),
        },
        false,
      );
    }
    if (!this.exists(pp.timeline)) {
      this.writePageRaw(
        {
          path: pp.timeline,
          frontmatter: {
            title: '共同经历',
            keys: [],
            summary: '与用户的共同经历（倒序）',
            updated: today,
            source: 'llm',
          },
          body: '',
        },
        false,
      );
    }
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
    const fm = MemoryPageFrontmatterSchema.safeParse(parsed.fm);
    if (!fm.success) return null;
    const page = MemoryPageSchema.safeParse({ path: rel, frontmatter: fm.data, body: parsed.body });
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

  /** 用户侧保存：raw 全文 → 校验 → source:user + updated=today → 原子写。非法抛 MemoryOpError。 */
  writeRaw(rel: string, raw: string): MemoryPage {
    const parsed = parseFrontmatter(raw);
    if (!parsed)
      throw new MemoryOpError('缺少 frontmatter（--- 包裹的 title/keys/summary/updated/source）');
    const fm = MemoryPageFrontmatterSchema.safeParse({
      ...parsed.fm,
      source: 'user',
      updated: this.today(),
    });
    if (!fm.success)
      throw new MemoryOpError(`frontmatter 非法：${fm.error.issues[0]?.message ?? ''}`);
    const page = MemoryPageSchema.safeParse({ path: rel, frontmatter: fm.data, body: parsed.body });
    if (!page.success) throw new MemoryOpError(`页面非法：${page.error.issues[0]?.message ?? ''}`);
    this.writePage(page.data);
    return page.data;
  }

  /** people/topics 删除文件；固定页重置为骨架。 */
  deletePage(rel: string, characterId: string): void {
    const kind = kindOf(rel);
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

  private listDir(relDir: string): string[] {
    const d = path.join(this.root, relDir);
    if (!existsSync(d)) return [];
    return readdirSync(d)
      .filter((n) => n.endsWith('.md') && n !== 'index.md')
      .sort()
      .map((n) => `${relDir}/${n}`);
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
    const out: MemoryPage[] = [];
    for (const r of rels) {
      const p = this.readPage(r);
      if (p) out.push(p);
    }
    return out;
  }

  private listAllCharacterIds(): string[] {
    const d = path.join(this.root, 'characters');
    if (!existsSync(d)) return [];
    return readdirSync(d, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  }

  // ---------- applyOps ----------

  /**
   * 五种操作（§3）。先在内存里全部校验并算出新页，再统一落盘——第 N 个非法则前 N-1 个不落盘。
   * 返回变更页路径（去重）。
   */
  applyOps(ops: readonly MemoryOp[], characterId: string): { changed: string[] } {
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
      kindOf(rel) === 'profile' ? MEMORY_QUOTAS.profileChars : MEMORY_QUOTAS.pageChars;
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
    const created: Array<'people' | 'topics'> = [];

    for (const op of ops) {
      switch (op.op) {
        case 'upsert_section': {
          guardPage(op.page);
          if (kindOf(op.page) === 'timeline') throw new MemoryOpError('timeline 只能 append/merge');
          if (op.content.includes(MEMORY_LOCKED_MARK))
            throw new MemoryOpError('LLM 不得写入锁定标记');
          dedupe(op.page, op.section);
          const page = load(op.page);
          const parsed = splitSections(page.body);
          const sec = parsed.sections.find((s) => s.name === op.section);
          if (!sec) throw new MemoryOpError(`节不存在：${op.page}#${op.section}`);
          if (isLocked(sec.body)) throw new MemoryOpError(`节已锁定：${op.page}#${op.section}`);
          sec.body = op.content.trim();
          const next = { ...page, body: joinSections(parsed) };
          checkQuota(next);
          bump(op.page, next);
          break;
        }
        case 'remove_line': {
          guardPage(op.page);
          if (kindOf(op.page) === 'timeline') throw new MemoryOpError('timeline 只能 append/merge');
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
          const rel = `user/${op.kind}/${op.slug}.md`;
          if (this.exists(rel) || work.has(rel)) throw new MemoryOpError(`页面已存在：${rel}`);
          const existing =
            this.listDir(`user/${op.kind}`).length + created.filter((k) => k === op.kind).length;
          if (existing >= MEMORY_QUOTAS.pagesPerKind)
            throw new MemoryOpError(`${op.kind} 页数超配额`);
          created.push(op.kind);
          const firstLine =
            op.content
              .split('\n')
              .find((l) => l.trim())
              ?.trim() ?? '';
          const page: MemoryPage = {
            path: rel,
            frontmatter: {
              title: op.title,
              keys: op.keys,
              summary: firstLine.replace(/^[-#*\s]+/, '').slice(0, 120),
              updated: today,
              source: 'llm',
            },
            body: op.content.trim(),
          };
          checkQuota(page);
          work.set(rel, page);
          break;
        }
        case 'append_timeline': {
          const page = load(pp.timeline);
          const entries = parseTimeline(page.body);
          if (entries.length >= MEMORY_QUOTAS.timelineEntries)
            throw new MemoryOpError('timeline 条目超配额，须先 merge_timeline');
          entries.push({ date: op.date, text: op.text.replace(/\s+/g, ' ').trim() });
          bump(pp.timeline, {
            ...page,
            body: serializeTimeline(
              entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
            ),
          });
          break;
        }
        case 'merge_timeline': {
          const page = load(pp.timeline);
          const entries = parseTimeline(page.body);
          const old = entries.filter((e) => e.date < op.before);
          if (old.length === 0)
            throw new MemoryOpError(`merge_timeline 无可合并条目（< ${op.before}）`);
          const keep = entries.filter((e) => e.date >= op.before);
          keep.push({
            date: op.before,
            text: `（此前合并）${op.text.replace(/\s+/g, ' ').trim()}`,
          });
          bump(pp.timeline, {
            ...page,
            body: serializeTimeline(
              keep.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
            ),
          });
          break;
        }
      }
    }

    const changed = [...work.keys()];
    for (const rel of changed) this.writePageRaw(work.get(rel)!, false);
    if (changed.length > 0) this.rebuildIndex();
    return { changed };
  }

  // ---------- 索引 / 树 / 搜索 ----------

  private indexLine(p: MemoryPage): string {
    const keys = p.frontmatter.keys.length ? ` · keys: ${p.frontmatter.keys.join(', ')}` : '';
    return `- [${p.frontmatter.title}](${p.path}) — ${p.frontmatter.summary}${keys}`;
  }

  /** 确定性输出（同内容 → 逐字节相等）：全局 index.md + 每角色 characters/<id>/index.md。 */
  rebuildIndex(): void {
    const userPages: MemoryPage[] = [];
    for (const r of [
      PROFILE_PATH,
      ...this.listDir('user/people'),
      ...this.listDir('user/topics'),
    ]) {
      const p = this.readPage(r);
      if (p) userPages.push(p);
    }
    const cids = this.listAllCharacterIds();
    const charPages = new Map<string, MemoryPage[]>();
    for (const cid of cids) {
      const pp = pagePaths(cid);
      const arr: MemoryPage[] = [];
      for (const r of [pp.relationship, pp.timeline]) {
        const p = this.readPage(r);
        if (p) arr.push(p);
      }
      charPages.set(cid, arr);
    }
    const userBlock = ['# 记忆索引', '', '## 用户', ...userPages.map((p) => this.indexLine(p))];
    const global = [...userBlock];
    for (const cid of cids) {
      global.push(
        '',
        `## 角色 ${cid}`,
        ...(charPages.get(cid) ?? []).map((p) => this.indexLine(p)),
      );
    }
    this.writeText(path.join(this.root, 'index.md'), global.join('\n') + '\n');
    for (const cid of cids) {
      const lines = [
        ...userBlock,
        '',
        '## 本角色',
        ...(charPages.get(cid) ?? []).map((p) => this.indexLine(p)),
      ];
      this.writeText(path.join(this.root, 'characters', cid, 'index.md'), lines.join('\n') + '\n');
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
    const f = path.join(this.root, 'characters', characterId, 'index.md');
    return existsSync(f) ? readFileSync(f, 'utf8') : '';
  }

  private node(p: MemoryPage): MemoryTreeNode {
    return {
      path: p.path,
      title: p.frontmatter.title,
      summary: p.frontmatter.summary,
      updated: p.frontmatter.updated,
      source: p.frontmatter.source,
    };
  }

  tree(characterId: string): MemoryTree {
    this.ensureLayout(characterId);
    const pp = pagePaths(characterId);
    const must = (rel: string): MemoryTreeNode => {
      const p = this.readPage(rel);
      if (!p) throw new MemoryOpError(`页面损坏：${rel}`);
      return this.node(p);
    };
    const nodes = (dir: string): MemoryTreeNode[] =>
      this.listDir(dir)
        .map((r) => this.readPage(r))
        .filter((p): p is MemoryPage => p !== null)
        .map((p) => this.node(p));
    return {
      profile: must(PROFILE_PATH),
      people: nodes('user/people'),
      topics: nodes('user/topics'),
      relationship: must(pp.relationship),
      timeline: must(pp.timeline),
    };
  }

  search(q: string, characterId: string): Array<{ path: string; title: string; snippet: string }> {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const hits: Array<{ path: string; title: string; snippet: string }> = [];
    for (const p of this.listPages(characterId)) {
      const inMeta =
        p.frontmatter.title.toLowerCase().includes(needle) ||
        p.frontmatter.keys.some((k) => k.toLowerCase().includes(needle));
      const line = p.body.split('\n').find((l) => l.toLowerCase().includes(needle));
      if (!inMeta && line === undefined) continue;
      const snippet = (line ?? p.frontmatter.summary).trim().slice(0, 120);
      hits.push({ path: p.path, title: p.frontmatter.title, snippet });
    }
    return hits;
  }

  pageCount(characterId: string): number {
    return this.listPages(characterId).length;
  }

  /** 页级向量索引输入：path + 内容 hash（变更检测）+ 嵌入文本。 */
  pagesForIndex(characterId: string): Array<{ path: string; hash: string; text: string }> {
    return this.listPages(characterId).map((p) => {
      const text = `${p.frontmatter.title}\n${p.frontmatter.keys.join(' ')}\n${p.body}`;
      return { path: p.path, hash: createHash('sha1').update(text).digest('hex'), text };
    });
  }

  // ---------- 三路注入视图 ----------

  /** 路 1 常驻：profile「一句话档案」(≤600) + relationship 全文(≤400) + timeline 最近 3 条。 */
  residentBlocks(characterId: string): string[] {
    const out: string[] = [];
    const profile = this.readPage(PROFILE_PATH);
    if (profile) {
      const sec = splitSections(profile.body).sections.find(
        (s) => s.name === MEMORY_PROFILE_SECTIONS[0],
      );
      const text = stripLock(sec?.body ?? '');
      if (text) out.push(`### 用户档案\n${text.slice(0, MEMORY_QUOTAS.residentProfileChars)}`);
    }
    const pp = pagePaths(characterId);
    const rel = this.readPage(pp.relationship);
    if (rel) {
      const parsed = splitSections(rel.body);
      const nonEmpty = parsed.sections.filter((s) => stripLock(s.body));
      if (nonEmpty.length) {
        const text = nonEmpty.map((s) => `${s.name}：${stripLock(s.body)}`).join('\n');
        out.push(`### 我们的关系\n${text.slice(0, MEMORY_QUOTAS.residentRelationshipChars)}`);
      }
    }
    const tl = this.readPage(pp.timeline);
    if (tl) {
      const recent = parseTimeline(tl.body).slice(0, MEMORY_QUOTAS.residentTimelineEntries);
      if (recent.length) out.push(`### 最近经历\n${serializeTimeline(recent)}`);
    }
    return out;
  }

  /** 路 2 投影：people/topics 每页一条 entry（keys = frontmatter keys + title；updated 倒序）。 */
  projectToLorebook(characterId: string): PackLorebook {
    const pages = this.listPages(characterId).filter((p) => {
      const k = kindOf(p.path);
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
          keys: [...new Set([...p.frontmatter.keys, p.frontmatter.title])].slice(0, 20),
          content: `### ${p.frontmatter.title}\n${p.body.slice(0, 8000)}`,
          enabled: true,
          insertionOrder: i,
          caseSensitive: false,
          constant: false,
          name: p.path,
        })),
    };
  }
}

function stripLock(body: string): string {
  return body.replace(MEMORY_LOCKED_MARK, '').trim();
}
