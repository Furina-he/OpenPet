/**
 * ㉒ F3 图谱视图模型（spec 2026-09-24-memory-graph-design §4.2 / §4.3 / §4.6；纯 TS 可测，无 DOM）。
 * 过滤（未建 / 提及 / 孤立）/ 度数与半径 / 配色键 / 邻居集 / 文字淡入 / 搜索命中 / 图例计数 /
 * 被想起光环分档 / 试一句命中环。canvas 装配在 MemoryGraph.vue。
 */
import type { MemoryGraph, MemoryGraphNode, MemoryProbeResult } from '@openpet/protocol';

export interface GraphFilters {
  /** 显示未建页面（ghost）。 */
  ghosts: boolean;
  /** 显示未链接提及（虚线边）。 */
  mentions: boolean;
  /** 显示孤立页（收成右下角的岛）。 */
  orphans: boolean;
}
export const DEFAULT_FILTERS: GraphFilters = { ghosts: false, mentions: false, orphans: true };

export type ColorKey = 'self' | 'people' | 'topics' | 'character' | 'ghost';

export interface ViewNode extends MemoryGraphNode {
  /** link 边度数（节点大小只看它，Obsidian 口径）。 */
  degree: number;
  radius: number;
  color: ColorKey;
  /** 度数 0 的页：不参与主图斥力，摆进孤岛。 */
  orphan: boolean;
}
export interface ViewEdge {
  source: string;
  target: string;
  kind: 'link' | 'mention';
  count: number;
  context?: string;
  /** 双向链接合并成一条。 */
  both: boolean;
}
export interface GraphView {
  nodes: ViewNode[];
  edges: ViewEdge[];
}

export function nodeRadius(kind: MemoryGraphNode['kind'], degree: number): number {
  const r = 4 + 2.2 * Math.sqrt(degree);
  return kind === 'profile' ? Math.max(12, r) : r;
}

export function colorKeyOf(kind: MemoryGraphNode['kind']): ColorKey {
  switch (kind) {
    case 'profile':
      return 'self';
    case 'people':
      return 'people';
    case 'topics':
      return 'topics';
    case 'ghost':
      return 'ghost';
    default:
      return 'character';
  }
}

/** 按开关过滤 + 度数 / 半径 / 配色 + 双向边合并。「我」永远在。 */
export function buildGraphView(g: MemoryGraph, f: GraphFilters): GraphView {
  const keepNode = new Set(
    g.nodes.filter((n) => f.ghosts || n.kind !== 'ghost').map((n) => n.id),
  );
  const raw = g.edges.filter(
    (e) =>
      keepNode.has(e.source) && keepNode.has(e.target) && (f.mentions || e.kind === 'link'),
  );
  const degree = new Map<string, number>();
  for (const e of raw) {
    if (e.kind !== 'link') continue;
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const nodes: ViewNode[] = [];
  for (const n of g.nodes) {
    if (!keepNode.has(n.id)) continue;
    const d = degree.get(n.id) ?? 0;
    const orphan = d === 0 && n.kind !== 'profile';
    if (orphan && !f.orphans) continue;
    nodes.push({
      ...n,
      degree: d,
      radius: nodeRadius(n.kind, d),
      color: colorKeyOf(n.kind),
      orphan,
    });
  }
  const alive = new Set(nodes.map((n) => n.id));
  const merged = new Map<string, ViewEdge>();
  for (const e of raw) {
    if (!alive.has(e.source) || !alive.has(e.target)) continue;
    const back = merged.get(`${e.kind}|${e.target}|${e.source}`);
    if (back) {
      back.both = true;
      back.count += e.count;
      continue;
    }
    merged.set(`${e.kind}|${e.source}|${e.target}`, {
      source: e.source,
      target: e.target,
      kind: e.kind,
      count: e.count,
      ...(e.context ? { context: e.context } : {}),
      both: false,
    });
  }
  return { nodes, edges: [...merged.values()] };
}

/** 一跳邻居（含自身）。 */
export function neighborsOf(edges: readonly ViewEdge[], id: string): Set<string> {
  const out = new Set([id]);
  for (const e of edges) {
    if (e.source === id) out.add(e.target);
    else if (e.target === id) out.add(e.source);
  }
  return out;
}

/** Obsidian text fade：k ≥ 1.1 全显；0.6–1.1 线性；< 0.6 不显（强制显示的另算）。 */
export function labelAlpha(k: number): number {
  if (k >= 1.1) return 1;
  if (k <= 0.6) return 0;
  return (k - 0.6) / 0.5;
}

/** 标题 / 别名 / 标签子串命中（大小写不敏感）。 */
export function searchHits(nodes: readonly MemoryGraphNode[], q: string): Set<string> {
  const needle = q.trim().toLowerCase();
  if (!needle) return new Set();
  return new Set(
    nodes
      .filter((n) =>
        [n.title, ...n.aliases, ...n.tags].some((s) => s.toLowerCase().includes(needle)),
      )
      .map((n) => n.id),
  );
}

export function legendCounts(nodes: readonly ViewNode[]): Record<ColorKey, number> {
  const out: Record<ColorKey, number> = { self: 0, people: 0, topics: 0, character: 0, ghost: 0 };
  for (const n of nodes) out[n.color]++;
  return out;
}

const HOUR = 3_600_000;
/** §4.3 被想起光环：1 小时内 35% / 1 天内 20% / 7 天内 10% / 更早不画。 */
export function recallGlow(lastAt: number | undefined, now: number): number {
  if (!lastAt) return 0;
  const age = now - lastAt;
  if (age < HOUR) return 0.35;
  if (age < 24 * HOUR) return 0.2;
  if (age < 7 * 24 * HOUR) return 0.1;
  return 0;
}

export type ProbeRoute = 'resident' | 'keyword' | 'vector';

/**
 * §4.6 试一句命中环：常驻三页细环、关键词暖环、向量冷环。常驻按块标题映射到本角色的固定页
 * （他角色只读节点不参与）。
 */
export function probeRings(
  nodes: readonly MemoryGraphNode[],
  r: MemoryProbeResult,
): Map<string, ProbeRoute> {
  const out = new Map<string, ProbeRoute>();
  const own = (kind: MemoryGraphNode['kind']): string | undefined =>
    nodes.find((n) => n.kind === kind && !n.readonly)?.id;
  for (const b of r.resident) {
    const kind = b.title.startsWith('用户档案')
      ? 'profile'
      : b.title.startsWith('我们的关系')
        ? 'relationship'
        : b.title.startsWith('最近经历')
          ? 'timeline'
          : null;
    const id = kind ? own(kind) : undefined;
    if (id) out.set(id, 'resident');
  }
  for (const p of r.pages) out.set(p.path, p.via);
  return out;
}
