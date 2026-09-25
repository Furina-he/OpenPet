/**
 * ㉒ 记忆图谱：vault 双链与文件名纯函数（spec 2026-09-24-memory-graph-design §1.2 / §1.4 /
 * §2.2–§2.4 / §4.4 / §5.1）。Main（编译器规范化 / 图谱 / 重命名 / 升级）与 renderer（预览渲染 /
 * 点击跳转）共用；零依赖、无 IO。
 *
 * 口径 = Obsidian 子集：`[[t]]` `[[t|d]]` `[[t#h]]` `[[t#h|d]]` `![[t]]` + 指向 `.md` 的标准链接；
 * 链接目标 = 文件名（大小写不敏感），**不按别名解析**——别名写法在落盘前规范化成 `[[文件名|别名]]`，
 * 所以 Obsidian 与应用内解析结果永远一致。
 */

export type MemoryPageKind = 'profile' | 'people' | 'topics' | 'relationship' | 'timeline';

/** 图谱 / 规范化所需的页面元信息（frontmatter 投影）。 */
export interface MemoryLinkPage {
  path: string;
  title: string;
  aliases: readonly string[];
}

export interface WikiLink {
  /** 链接目标原文（`[[目标#节|显示]]` 的「目标」；md 链接 = 解码后的相对路径，含 `.md`）。 */
  target: string;
  heading?: string;
  display?: string;
  /** `![[x]]` / `![x](y.md)`。 */
  embed: boolean;
  /** 标准 markdown 链接 `[文字](x.md)`。 */
  markdown: boolean;
  start: number;
  end: number;
}

const FIXED_PAGE_RE =
  /^(?:user\/profile\.md|characters\/[a-z0-9][a-z0-9-]*\/(?:relationship|timeline)\.md)$/;
const NAMED_PAGE_RE = /^user\/(?:people|topics)\/([^/\\]+)\.md$/;
const RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function trimDotsSpaces(s: string): string {
  return s.replace(/^[.\s]+|[.\s]+$/g, '');
}

/**
 * 标题 → 文件名（不含 `.md`）：NFC → 去首尾空白 → Windows / Obsidian 非法字符与控制字符换 `-` →
 * 连续空白 / `-` 折叠 → 去首尾 `.` 与空白 → 截 60 个 UTF-16 单元 → 保留名后缀 `_` → 空串回退「未命名」。
 * 幂等：`memoryFileStem(memoryFileStem(x)) === memoryFileStem(x)`（路径白名单靠这一点判定合法 stem）。
 */
export function memoryFileStem(title: string): string {
  let s = title.normalize('NFC').trim();
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\\/:*?"<>|#^[\]\u0000-\u001f\u007f]/g, '-');
  s = s.replace(/\s+/g, ' ').replace(/-{2,}/g, '-');
  s = trimDotsSpaces(s);
  if (s.length > 60) {
    s = s.slice(0, 60);
    if (/[\ud800-\udbff]$/.test(s)) s = s.slice(0, -1);
    s = trimDotsSpaces(s);
  }
  if (!s) return '未命名';
  const m = RESERVED_RE.exec(s);
  if (m) s = trimDotsSpaces(`${m[1]}_${m[2] ?? ''}`.slice(0, 60));
  return s;
}

/**
 * 页面路径白名单（取代 ⑲ 的 MEMORY_PAGE_PATH_RE）：固定页规则不变；人物 / 话题的 stem 接受
 * 任何「经 memoryFileStem 不变」的串（含中文；旧 ASCII slug 天然合法）。挡穿越：段内无 `/ \`、
 * 不以 `.` 开头、无控制字符（均由 stem 规则保证）。
 */
export function isMemoryPagePath(p: string): boolean {
  if (FIXED_PAGE_RE.test(p)) return true;
  const m = NAMED_PAGE_RE.exec(p);
  if (!m) return false;
  const stem = m[1]!;
  return !stem.startsWith('.') && stem === memoryFileStem(stem);
}

export function memoryPageKind(p: string): MemoryPageKind {
  if (p === 'user/profile.md') return 'profile';
  if (p.startsWith('user/people/')) return 'people';
  if (p.startsWith('user/topics/')) return 'topics';
  return p.endsWith('/timeline.md') ? 'timeline' : 'relationship';
}

/** 路径 → 文件名（去目录与 `.md`）。 */
export function memoryPageStem(p: string): string {
  const base = p.slice(p.lastIndexOf('/') + 1);
  return base.replace(/\.md$/i, '');
}

const EDGE_PUNCT_RE =
  /^[「」『』《》“”‘’"'()（）[\]【】,，.。、\s]+|[「」『』《》“”‘’"'()（）[\]【】,，.。、\s]+$/g;

/**
 * 名称规范化（撞名判定 / 别名匹配共用）：NFC → 去首尾空白 → 去两端括号引号与中英文逗号句号 →
 * 连续空白折叠 → 转小写。
 */
export function canonicalName(s: string): string {
  return s.normalize('NFC').replace(EDGE_PUNCT_RE, '').replace(/\s+/g, ' ').toLowerCase();
}

const lower = (s: string): string => s.normalize('NFC').toLowerCase();

// ---------- 解析 ----------

/** code 区（fenced + 行内）换成等长 `\0`，保持下标对齐。 */
function maskCode(md: string): string {
  const lines = md.split('\n');
  let inFence = false;
  let fence = '';
  const out: string[] = [];
  for (const line of lines) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (inFence) {
      out.push('\0'.repeat(line.length));
      if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length) inFence = false;
      continue;
    }
    if (m) {
      inFence = true;
      fence = m[1]!;
      out.push('\0'.repeat(line.length));
      continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/(`+)[^`]*?\1/g, (s) => '\0'.repeat(s.length));
}

const blank = (s: string): string => '\0'.repeat(s.length);
const WIKI_RE = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const MD_LINK_RE = /(!?)\[([^\]\n]*)\]\(<?([^()\s<>]+?\.md)(#[^()\s<>]*)?>?\)/gi;

function splitInner(inner: string): { target: string; heading?: string; display?: string } {
  const bar = /\\?\|/.exec(inner);
  const head = bar ? inner.slice(0, bar.index) : inner;
  const display = bar ? inner.slice(bar.index + bar[0].length).trim() : undefined;
  const hash = head.indexOf('#');
  const target = (hash < 0 ? head : head.slice(0, hash)).trim();
  const heading = hash < 0 ? undefined : head.slice(hash + 1).trim();
  return {
    target,
    ...(heading ? { heading } : {}),
    ...(display ? { display } : {}),
  };
}

/** 解析双链与指向 `.md` 的标准链接；跳过 fenced / 行内 code；按出现顺序返回。 */
export function parseWikilinks(md: string): WikiLink[] {
  const out: WikiLink[] = [];
  let masked = maskCode(md);
  for (const m of masked.matchAll(WIKI_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const parts = splitInner(md.slice(start + m[1]!.length + 2, end - 2));
    if (!parts.target) continue;
    out.push({ ...parts, embed: m[1] === '!', markdown: false, start, end });
  }
  masked = masked.replace(WIKI_RE, blank);
  for (const m of masked.matchAll(MD_LINK_RE)) {
    const raw = m[3]!;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    let target = raw;
    try {
      target = decodeURIComponent(raw);
    } catch {
      /* 保留原串 */
    }
    const start = m.index ?? 0;
    const heading = m[4] ? m[4].slice(1) : '';
    const display = m[2]!.trim();
    out.push({
      target: target.replace(/^\.\//, ''),
      ...(heading ? { heading } : {}),
      ...(display ? { display } : {}),
      embed: m[1] === '!',
      markdown: true,
      start,
      end: start + m[0].length,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---------- 解析目标 ----------

function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

function joinPath(dir: string, rel: string): string {
  const parts = dir ? dir.split('/') : [];
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

const KIND_RANK: Record<MemoryPageKind, number> = {
  people: 1,
  topics: 2,
  profile: 3,
  relationship: 4,
  timeline: 4,
};

/**
 * 链接目标 → 页路径；解析不到 = null（未建页面 / ghost）。
 * 含 `/` → vault 路径（补 `.md`；也接受路径后缀）；否则按文件名匹配，多个同名 → 与来源同目录优先 →
 * people → topics → 固定页。`markdown: true` = 标准 md 链接（相对当前文件，再试 vault 根）。
 */
export function resolveLink(
  target: string,
  fromPath: string,
  pages: ReadonlyArray<{ path: string }>,
  opts: { markdown?: boolean } = {},
): string | null {
  const byPath = new Map(pages.map((p) => [lower(p.path), p.path]));
  const t = target.trim().replace(/\\/g, '/');
  if (!t) return null;
  if (opts.markdown) {
    const withMd = /\.md$/i.test(t) ? t : `${t}.md`;
    return (
      byPath.get(lower(joinPath(dirOf(fromPath), withMd))) ??
      byPath.get(lower(joinPath('', withMd))) ??
      null
    );
  }
  const bare = t.replace(/\.md$/i, '');
  if (bare.includes('/')) {
    const want = lower(joinPath('', bare) + '.md');
    const exact = byPath.get(want);
    if (exact) return exact;
    const suffix = pages.filter((p) => lower(p.path).endsWith(`/${want}`));
    return suffix.length === 1 ? suffix[0]!.path : null;
  }
  const want = lower(bare);
  const hits = pages.filter((p) => lower(memoryPageStem(p.path)) === want);
  if (hits.length === 0) return null;
  const from = dirOf(fromPath);
  const rank = (p: string): number => (dirOf(p) === from ? 0 : KIND_RANK[memoryPageKind(p)]);
  hits.sort((a, b) => rank(a.path) - rank(b.path) || (a.path < b.path ? -1 : 1));
  return hits[0]!.path;
}

/**
 * 写进 `[[ ]]` 的目标名：默认文件名；与其他页（人物 / 话题 / 档案）同名时用路径形式（去 `.md`），
 * 保证 Obsidian 与应用内解析到同一页。
 */
export function memoryLinkName(p: string, pages: ReadonlyArray<{ path: string }>): string {
  const stem = memoryPageStem(p);
  const k = memoryPageKind(p);
  if (k === 'relationship' || k === 'timeline') return p.replace(/\.md$/, '');
  const clash = pages.some(
    (o) =>
      o.path !== p &&
      memoryPageKind(o.path) !== 'relationship' &&
      memoryPageKind(o.path) !== 'timeline' &&
      lower(memoryPageStem(o.path)) === lower(stem),
  );
  return clash ? p.replace(/\.md$/, '') : stem;
}

function formatLink(
  name: string,
  opts: { heading?: string | undefined; display?: string | undefined; embed?: boolean },
): string {
  const h = opts.heading ? `#${opts.heading}` : '';
  const d = opts.display && opts.display !== name ? `|${opts.display}` : '';
  return `${opts.embed ? '!' : ''}[[${name}${h}${d}]]`;
}

function replaceRanges(
  md: string,
  edits: ReadonlyArray<{ start: number; end: number; text: string }>,
): string {
  let out = md;
  for (const e of [...edits].sort((a, b) => b.start - a.start))
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** 按标题 / 别名找页（只在人物 / 话题 / 档案里找）：标题优先于别名，人物优先于话题。 */
function findByName(name: string, pages: readonly MemoryLinkPage[]): MemoryLinkPage | null {
  const cn = canonicalName(name);
  if (!cn) return null;
  let best: { page: MemoryLinkPage; rank: number } | null = null;
  for (const p of pages) {
    const k = memoryPageKind(p.path);
    if (k === 'relationship' || k === 'timeline') continue;
    let r = -1;
    if (canonicalName(p.title) === cn) r = 0;
    else if (p.aliases.some((a) => canonicalName(a) === cn)) r = 10;
    if (r < 0) continue;
    r += KIND_RANK[k];
    if (!best || r < best.rank) best = { page: p, rank: r };
  }
  return best?.page ?? null;
}

/**
 * 链接规范化（spec §2.3 第 1–2 条）：`[[X]]` / `[[X|Y]]` 的 X 不是文件名、但命中某页标题或别名 →
 * `[[文件名|X]]`（有 Y 保留 Y）；解析不到且 `dropUnresolved` → 降为纯文本（LLM 写入防悬空）。
 * md 链接与 code 内不动。
 */
export function normalizeLinks(
  md: string,
  pages: readonly MemoryLinkPage[],
  opts: { dropUnresolved: boolean; from?: string },
): string {
  const from = opts.from ?? '';
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const l of parseWikilinks(md)) {
    if (l.markdown) continue;
    if (resolveLink(l.target, from, pages)) continue;
    const page = l.target.includes('/') ? null : findByName(l.target, pages);
    if (page) {
      edits.push({
        start: l.start,
        end: l.end,
        text: formatLink(memoryLinkName(page.path, pages), {
          heading: l.heading,
          display: l.display ?? l.target,
          embed: l.embed,
        }),
      });
    } else if (opts.dropUnresolved) {
      edits.push({ start: l.start, end: l.end, text: l.display ?? l.target });
    }
  }
  return edits.length ? replaceRanges(md, edits) : md;
}

// ---------- 提及补链 ----------

const ASCII_RE = /^[\x20-\x7e]+$/;
const WORD_CH_RE = /[A-Za-z0-9_]/;
const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

interface MentionTarget {
  path: string;
  link: string;
  keys: string[];
}

/** 已链到该目标（文件名 / 链接名 / 路径形式任一相等）。 */
function linksTo(l: WikiLink, t: MentionTarget): boolean {
  const x = lower(l.target.replace(/\.md$/i, ''));
  const stem = lower(memoryPageStem(t.path));
  if (l.markdown) return lower(memoryPageStem(l.target)) === stem;
  return (
    x === stem || x === lower(t.link) || lower(t.path.replace(/\.md$/, '')).endsWith(`/${x}`)
  );
}

/**
 * 提及补链（spec §5.1 第 5 步 / §2.3 第 3 条）：逐节（`## ` 切分，无标题 = 整篇一节），把其它人物 /
 * 话题页的标题 / 别名 / 文件名**每节第一次出现**改写为 `[[文件名]]` 或 `[[文件名|原文]]`。
 * 词长 ≥2；纯 ASCII 词另需词边界；长词优先；跳过 frontmatter / code / 已有链接 / 注释 / 标题行 /
 * 锁定节 / 自身；该节已链到过该目标则跳过（幂等）。固定页不作目标。
 */
export function linkifyMentions(
  md: string,
  pages: readonly MemoryLinkPage[],
  opts: { self?: string } = {},
): string {
  const targets: MentionTarget[] = [];
  for (const p of pages) {
    const k = memoryPageKind(p.path);
    if ((k !== 'people' && k !== 'topics') || p.path === opts.self) continue;
    const keys = [
      ...new Set(
        [p.title, ...p.aliases, memoryPageStem(p.path)]
          .map((n) => n.normalize('NFC').trim())
          .filter((n) => [...n].length >= 2 && !/[[\]|#\n]/.test(n)),
      ),
    ];
    if (keys.length) targets.push({ path: p.path, link: memoryLinkName(p.path, pages), keys });
  }
  if (targets.length === 0) return md;
  const cands = targets
    .flatMap((t) => t.keys.map((k) => ({ t, key: k, lkey: asciiLower(k), ascii: ASCII_RE.test(k) })))
    .sort(
      (a, b) =>
        b.key.length - a.key.length ||
        KIND_RANK[memoryPageKind(a.t.path)] - KIND_RANK[memoryPageKind(b.t.path)],
    );
  const byFirst = new Map<string, typeof cands>();
  for (const c of cands) {
    const f = c.lkey[0]!;
    const arr = byFirst.get(f);
    if (arr) arr.push(c);
    else byFirst.set(f, [c]);
  }

  // frontmatter 原样保留
  let head = '';
  let body = md;
  if (/^---\r?\n/.test(md)) {
    const end = md.indexOf('\n---', 3);
    if (end >= 0) {
      const cut = md.indexOf('\n', end + 4);
      head = cut < 0 ? md : md.slice(0, cut + 1);
      body = cut < 0 ? '' : md.slice(cut + 1);
    }
  }

  // 切节：`## ` 标题行起新节
  const lines = body.split('\n');
  const sections: string[] = [];
  let cur: string[] = [];
  for (const line of lines) {
    if (/^##\s/.test(line) && cur.length) {
      sections.push(cur.join('\n'));
      cur = [];
    }
    cur.push(line);
  }
  sections.push(cur.join('\n'));

  const done = sections.map((sec) => {
    const firstContent = sec.split('\n').find((l) => l.trim() && !/^#{1,6}\s/.test(l));
    if (firstContent?.trimStart().startsWith('<!-- locked -->')) return sec;
    const links = parseWikilinks(sec);
    const used = new Set(targets.filter((t) => links.some((l) => linksTo(l, t))).map((t) => t.path));
    let masked = maskCode(sec)
      .replace(WIKI_RE, blank)
      .replace(MD_LINK_RE, blank)
      .replace(/\[[^\]\n]*\]\([^)\n]*\)/g, blank)
      .replace(/<!--[\s\S]*?-->/g, blank)
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, blank)
      .replace(/^#{1,6}\s.*$/gm, blank);
    masked = asciiLower(masked);
    const edits: Array<{ start: number; end: number; text: string }> = [];
    for (let i = 0; i < masked.length; i++) {
      const bucket = byFirst.get(masked[i]!);
      if (!bucket) continue;
      for (const c of bucket) {
        if (used.has(c.t.path) || !masked.startsWith(c.lkey, i)) continue;
        const end = i + c.lkey.length;
        if (
          c.ascii &&
          ((i > 0 && WORD_CH_RE.test(masked[i - 1]!)) ||
            (end < masked.length && WORD_CH_RE.test(masked[end]!)))
        )
          continue;
        const orig = sec.slice(i, end);
        edits.push({ start: i, end, text: formatLink(c.t.link, { display: orig }) });
        used.add(c.t.path);
        i = end - 1;
        break;
      }
    }
    return edits.length ? replaceRanges(sec, edits) : sec;
  });
  return head + done.join('\n');
}

// ---------- 重命名 / 纯文本投影 ----------

/**
 * 重命名改写（spec §4.4）：指向 `fromPath` 的双链与 md 链接改指 `toPath`，保留 `#节` / `|显示` /
 * `!` 与写法（文件名形式仍写文件名，路径形式写新路径）。`pointsToFrom` 缺省 = 目标名与旧文件名 /
 * 旧路径相等（调用方可传 resolveLink 闭包做精确判定）。
 */
export function rewriteLinkTarget(
  md: string,
  fromPath: string,
  toPath: string,
  pointsToFrom?: (link: WikiLink) => boolean,
): string {
  const fromStem = lower(memoryPageStem(fromPath));
  const fromBare = lower(fromPath.replace(/\.md$/, ''));
  const toStem = memoryPageStem(toPath);
  const toBare = toPath.replace(/\.md$/, '');
  const hit =
    pointsToFrom ??
    ((l: WikiLink): boolean => {
      if (l.markdown) return lower(memoryPageStem(l.target)) === fromStem;
      const x = lower(l.target.replace(/\.md$/i, ''));
      return x.includes('/') ? fromBare === x || fromBare.endsWith(`/${x}`) : x === fromStem;
    });
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const l of parseWikilinks(md)) {
    if (!hit(l)) continue;
    if (l.markdown) {
      const dir = l.target.includes('/') ? l.target.slice(0, l.target.lastIndexOf('/') + 1) : '';
      const target = `${dir}${toStem}.md`.replace(/ /g, '%20');
      const h = l.heading ? `#${l.heading}` : '';
      edits.push({
        start: l.start,
        end: l.end,
        text: `${l.embed ? '!' : ''}[${l.display ?? ''}](${target}${h})`,
      });
      continue;
    }
    edits.push({
      start: l.start,
      end: l.end,
      text: formatLink(l.target.includes('/') ? toBare : toStem, {
        heading: l.heading,
        display: l.display,
        embed: l.embed,
      }),
    });
  }
  return edits.length ? replaceRanges(md, edits) : md;
}

/**
 * 注入 LLM 的纯文本投影（spec §2.4）：`[[a|b]]` → b；`[[a#h]]` / `[[a]]` / `![[a]]` → a（路径形式
 * 取末段）；`[文字](x.md)` → 文字；删 `<!-- locked -->`。
 */
export function toPlainText(md: string): string {
  return md
    .replace(/<!-- locked -->[ \t]*\n?/g, '')
    .replace(WIKI_RE, (_m, _bang: string, inner: string) => {
      const p = splitInner(inner);
      if (p.display) return p.display;
      if (!p.target) return p.heading ?? '';
      return p.target.slice(p.target.lastIndexOf('/') + 1).replace(/\.md$/i, '');
    })
    .replace(MD_LINK_RE, (_m, _bang: string, text: string) => text);
}
