/**
 * ㉒ 记忆图谱构建（spec 2026-09-24-memory-graph-design §3；纯函数，无 IO）。
 *
 * 图 = 文件链接的实时投影（不另存图数据）：节点 = 页（+ 未建页面 ghost），边 = 双链 / md 链接
 * （link）与未链接提及（mention，默认隐藏）。每次全量现算：页数上限 60+60+1+2N，预期 < 20ms。
 * 链接解析永远对全库做（scope=current 时指向他角色页的边直接丢，不算 ghost）。
 */
import {
  canonicalName,
  memoryPageKind,
  memoryPageStem,
  parseWikilinks,
  resolveLink,
  toPlainText,
  type MemoryGraph,
  type MemoryGraphEdge,
  type MemoryGraphNode,
  type MemoryPage,
} from '@openpet/protocol';

export interface BuildGraphOptions {
  scope: 'current' | 'all';
  currentCid: string;
  /** cid → 角色名（查不到回 cid）。 */
  characterName: (cid: string) => string;
  /** §3.1 被想起的痕迹：path → 统计（只挂到人物 / 话题节点）。 */
  recall?: ReadonlyMap<string, { count: number; lastAt: number }>;
}

const CONTEXT_MAX = 80;

function cidOf(p: string): string | undefined {
  const m = /^characters\/([^/]+)\//.exec(p);
  return m ? m[1] : undefined;
}

/** 链接所在行的纯文本（去列表 / 引用前缀），≤80 字。 */
function lineContext(md: string, at: number): string {
  const s = md.lastIndexOf('\n', at - 1) + 1;
  const e = md.indexOf('\n', at);
  const line = md.slice(s, e < 0 ? md.length : e);
  return toPlainText(line)
    .replace(/^\s*(?:[-*+>]|\d+\.)\s*/, '')
    .trim()
    .slice(0, CONTEXT_MAX);
}

/** 去掉链接与 code 后的正文（提及检测用：链接里的文字不算「未链接提及」）。 */
function unlinkedText(md: string): string {
  const links = parseWikilinks(md);
  let out = '';
  let i = 0;
  for (const l of links) {
    out += md.slice(i, l.start) + ' ';
    i = l.end;
  }
  out += md.slice(i);
  return out
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

const ASCII_RE = /^[\x20-\x7e]+$/;

/** ASCII 名需词边界（防「Al」命中「Also」）；正则按名缓存，页多时不反复编译。 */
function mentions(text: string, name: string, cache: Map<string, RegExp>): number {
  const n = name.trim();
  if ([...n].length < 2) return -1;
  if (!ASCII_RE.test(n)) return text.indexOf(n);
  let re = cache.get(n);
  if (!re) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`(?<![A-Za-z0-9_])${esc}(?![A-Za-z0-9_])`, 'i');
    cache.set(n, re);
  }
  const m = re.exec(text);
  return m ? m.index : -1;
}

const KIND_ORDER = { profile: 0, people: 1, topics: 2, relationship: 3, timeline: 4, ghost: 5 };

export function buildMemoryGraph(allPages: readonly MemoryPage[], opts: BuildGraphOptions): MemoryGraph {
  const inScope = (p: string): boolean => {
    const c = cidOf(p);
    return c === undefined || opts.scope === 'all' || c === opts.currentCid;
  };
  const pages = allPages.filter((p) => inScope(p.path));
  const nodes = new Map<string, MemoryGraphNode>();
  for (const p of pages) {
    const kind = memoryPageKind(p.path);
    const cid = cidOf(p.path);
    const title =
      kind === 'profile'
        ? '我'
        : kind === 'relationship'
          ? `${opts.characterName(cid!)} · 关系`
          : kind === 'timeline'
            ? `${opts.characterName(cid!)} · 经历`
            : p.frontmatter.title;
    const recall =
      (kind === 'people' || kind === 'topics') && opts.recall?.get(p.path);
    nodes.set(p.path, {
      id: p.path,
      title,
      kind,
      ...(cid ? { characterId: cid } : {}),
      tags: [...p.frontmatter.tags],
      aliases: [...p.frontmatter.aliases],
      updated: p.frontmatter.updated,
      chars: toPlainText(p.body).trim().length,
      readonly: cid !== undefined && cid !== opts.currentCid,
      ...(recall && recall.count > 0 ? { recall: { count: recall.count, lastAt: recall.lastAt } } : {}),
    });
  }

  const edges = new Map<string, MemoryGraphEdge>();
  const addEdge = (
    source: string,
    target: string,
    kind: 'link' | 'mention',
    context: string,
  ): void => {
    const key = `${kind}|${source}|${target}`;
    const e = edges.get(key);
    if (e) {
      e.count++;
      return;
    }
    edges.set(key, { source, target, kind, count: 1, ...(context ? { context } : {}) });
  };

  // link 边（含 ghost）
  for (const p of pages) {
    for (const l of parseWikilinks(p.body)) {
      const to = resolveLink(l.target, p.path, allPages, { markdown: l.markdown });
      if (to === p.path) continue; // 自环丢弃
      if (to) {
        if (!nodes.has(to)) continue; // 指向范围外（他角色页）
        addEdge(p.path, to, 'link', lineContext(p.body, l.start));
        continue;
      }
      const name = memoryPageStem(l.target.replace(/\\/g, '/'));
      const key = canonicalName(name);
      if (!key) continue;
      const id = `ghost:${key}`;
      if (!nodes.has(id))
        nodes.set(id, {
          id,
          title: name,
          kind: 'ghost',
          tags: [],
          aliases: [],
          chars: 0,
          readonly: false,
        });
      addEdge(p.path, id, 'link', lineContext(p.body, l.start));
    }
  }

  // mention 边：P 的正文（去链接后）出现 Q 的标题 / 别名，且 P→Q 无显式链接；固定页不作目标
  const linked = new Set([...edges.values()].map((e) => `${e.source}|${e.target}`));
  const targets = pages.filter((q) => {
    const k = memoryPageKind(q.path);
    return k === 'people' || k === 'topics';
  });
  const reCache = new Map<string, RegExp>();
  for (const p of pages) {
    const text = unlinkedText(p.body);
    for (const q of targets) {
      if (q.path === p.path || linked.has(`${p.path}|${q.path}`)) continue;
      let at = -1;
      for (const n of [q.frontmatter.title, ...q.frontmatter.aliases]) {
        at = mentions(text, n, reCache);
        if (at >= 0) break;
      }
      if (at >= 0) addEdge(p.path, q.path, 'mention', lineContext(text, at));
    }
  }

  const nodeList = [...nodes.values()].sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const edgeList = [...edges.values()];
  const linkEdges = edgeList.filter((e) => e.kind === 'link');
  const degree = new Map<string, number>();
  for (const e of linkEdges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const pageNodes = nodeList.filter((n) => n.kind !== 'ghost');
  return {
    nodes: nodeList,
    edges: edgeList,
    stats: {
      pages: pageNodes.length,
      links: linkEdges.length,
      ghosts: nodeList.length - pageNodes.length,
      orphans: pageNodes.filter((n) => !degree.get(n.id)).length,
    },
  };
}
