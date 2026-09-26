import { describe, expect, it } from 'vitest';
import type { MemoryGraph, MemoryGraphNode } from '@openpet/protocol';
import {
  buildGraphView,
  colorKeyOf,
  DEFAULT_FILTERS,
  labelAlpha,
  legendCounts,
  neighborsOf,
  nodeRadius,
  probeRings,
  recallGlow,
  searchHits,
} from '../src/renderer/settings/memory-graph-model.js';
import {
  createWidthCache,
  labelFontPx,
  placeLabels,
  truncateLabel,
  type LabelCandidate,
} from '../src/renderer/settings/graph-labels.js';
import {
  boundsOf,
  centerOn,
  fitBounds,
  lerpCamera,
  panBy,
  toScreen,
  toWorld,
  zoomAt,
} from '../src/renderer/settings/graph-camera.js';
import {
  boundingCircle,
  debounce,
  initialPosition,
  islandPositions,
  loadPositions,
  savePositions,
  GRAPH_POS_PREFIX,
} from '../src/renderer/settings/graph-layout.js';
import {
  createSim,
  mergePositions,
  pin,
  settleSync,
  unpin,
  type SimNode,
} from '../src/renderer/settings/graph-sim.js';
import { createLatestRequest } from '../src/renderer/settings/latest-request.js';

const n = (
  id: string,
  kind: MemoryGraphNode['kind'],
  extra: Partial<MemoryGraphNode> = {},
): MemoryGraphNode => ({
  id,
  title: extra.title ?? id,
  kind,
  tags: [],
  aliases: [],
  chars: 1,
  readonly: false,
  ...extra,
});
const G: MemoryGraph = {
  nodes: [
    n('user/profile.md', 'profile', { title: '我' }),
    n('user/people/王小明.md', 'people', { title: '王小明', aliases: ['小王'], tags: ['同事'] }),
    n('user/topics/爬山.md', 'topics', { title: '爬山' }),
    n('user/topics/天气.md', 'topics', { title: '天气' }),
    n('characters/c/relationship.md', 'relationship', { characterId: 'c' }),
    n('characters/c/timeline.md', 'timeline', { characterId: 'c' }),
    n('characters/o/timeline.md', 'timeline', { characterId: 'o', readonly: true }),
    n('ghost:珠峰', 'ghost', { title: '珠峰' }),
  ],
  edges: [
    { source: 'user/profile.md', target: 'user/people/王小明.md', kind: 'link', count: 1 },
    { source: 'user/people/王小明.md', target: 'user/profile.md', kind: 'link', count: 2 },
    { source: 'user/people/王小明.md', target: 'user/topics/爬山.md', kind: 'link', count: 1 },
    { source: 'characters/c/relationship.md', target: 'user/profile.md', kind: 'link', count: 1 },
    { source: 'user/topics/爬山.md', target: 'ghost:珠峰', kind: 'link', count: 1 },
    { source: 'user/topics/天气.md', target: 'user/people/王小明.md', kind: 'mention', count: 1 },
  ],
  stats: { pages: 7, links: 5, ghosts: 1, orphans: 3 },
};

describe('㉒ memory-graph-model', () => {
  it('默认过滤：无 ghost / 无 mention；双向边合并；度数与半径；孤立页标记', () => {
    const v = buildGraphView(G, DEFAULT_FILTERS);
    expect(v.nodes.some((x) => x.kind === 'ghost')).toBe(false);
    expect(v.edges.some((e) => e.kind === 'mention')).toBe(false);
    const both = v.edges.find(
      (e) => e.source === 'user/profile.md' && e.target === 'user/people/王小明.md',
    )!;
    expect(both).toMatchObject({ both: true, count: 3 });
    expect(v.edges.filter((e) => e.target === 'user/profile.md' && e.source.includes('王小明'))).toEqual([]);
    const wm = v.nodes.find((x) => x.id === 'user/people/王小明.md')!;
    expect(wm.degree).toBe(3);
    expect(wm.radius).toBeCloseTo(4 + 2.2 * Math.sqrt(3));
    expect(v.nodes.find((x) => x.id === 'user/topics/天气.md')!.orphan).toBe(true);
    expect(nodeRadius('profile', 0)).toBe(12);
  });

  it('开关：ghost / mention 打开出现；孤立页关掉则隐藏（「我」永远在）', () => {
    const all = buildGraphView(G, { ghosts: true, mentions: true, orphans: true });
    expect(all.nodes.some((x) => x.id === 'ghost:珠峰')).toBe(true);
    expect(all.edges.some((e) => e.kind === 'mention')).toBe(true);
    const noOrph = buildGraphView(G, { ghosts: false, mentions: false, orphans: false });
    expect(noOrph.nodes.map((x) => x.id)).not.toContain('user/topics/天气.md');
    expect(noOrph.nodes.map((x) => x.id)).toContain('user/profile.md');
  });

  it('配色 / 邻居 / 文字淡入 / 搜索 / 图例 / 光环分档', () => {
    expect(colorKeyOf('profile')).toBe('self');
    expect(colorKeyOf('timeline')).toBe('character');
    const v = buildGraphView(G, DEFAULT_FILTERS);
    expect(neighborsOf(v.edges, 'user/people/王小明.md')).toEqual(
      new Set(['user/people/王小明.md', 'user/profile.md', 'user/topics/爬山.md']),
    );
    expect(labelAlpha(2)).toBe(1);
    expect(labelAlpha(0.85)).toBeCloseTo(0.5);
    expect(labelAlpha(0.5)).toBe(0);
    expect(searchHits(G.nodes, '小王')).toEqual(new Set(['user/people/王小明.md']));
    expect(searchHits(G.nodes, '同事')).toEqual(new Set(['user/people/王小明.md']));
    expect(searchHits(G.nodes, ' ')).toEqual(new Set());
    expect(legendCounts(v.nodes)).toMatchObject({ self: 1, people: 1, topics: 2, character: 3 });
    const now = 10 * 24 * 3_600_000;
    expect(recallGlow(now - 60_000, now)).toBe(0.35);
    expect(recallGlow(now - 2 * 3_600_000, now)).toBe(0.2);
    expect(recallGlow(now - 3 * 24 * 3_600_000, now)).toBe(0.1);
    expect(recallGlow(now - 8 * 24 * 3_600_000, now)).toBe(0);
    expect(recallGlow(undefined, now)).toBe(0);
  });

  it('试一句命中环：常驻映射到本角色固定页；关键词 / 向量按路线', () => {
    const rings = probeRings(G.nodes, {
      resident: [
        { title: '用户档案', chars: 10 },
        { title: '最近经历（我记下的）', chars: 5 },
      ],
      pages: [
        { path: 'user/people/王小明.md', title: '王小明', via: 'keyword', chars: 9 },
        { path: 'user/topics/爬山.md', title: '爬山', via: 'vector', score: 0.8, chars: 5 },
      ],
      injectedChars: 29,
      budget: 2500,
      preview: '',
    });
    expect([...rings]).toEqual([
      ['user/profile.md', 'resident'],
      ['characters/c/timeline.md', 'resident'],
      ['user/people/王小明.md', 'keyword'],
      ['user/topics/爬山.md', 'vector'],
    ]);
  });
});

describe('㉒ graph-labels', () => {
  it('字号取整与限幅；截断按汉字宽', () => {
    expect(labelFontPx(1)).toBe(12);
    expect(labelFontPx(0.1)).toBe(10);
    expect(labelFontPx(9)).toBe(16);
    expect(labelFontPx(1.04)).toBe(12);
    expect(Number.isInteger(labelFontPx(1.17))).toBe(true);
    expect(truncateLabel('一二三四五六七八九十')).toBe('一二三四五六七八九十');
    expect(truncateLabel('一二三四五六七八九十十一十二十三')).toBe('一二三四五六七八九十十一…');
    expect(truncateLabel('a'.repeat(24))).toBe('a'.repeat(24));
    expect(truncateLabel('a'.repeat(25))).toBe(`${'a'.repeat(24)}…`);
  });

  it('宽度缓存：同 font|text 只量一次', () => {
    let calls = 0;
    const w = createWidthCache((_f, t) => {
      calls++;
      return t.length * 10;
    });
    expect(w('12px a', '王')).toBe(10);
    expect(w('12px a', '王')).toBe(10);
    expect(w('13px a', '王')).toBe(10);
    expect(calls).toBe(2);
  });

  const c = (id: string, tier: LabelCandidate['tier'], x: number, degree = 0): LabelCandidate => ({
    id,
    tier,
    degree,
    title: id,
    x,
    y: 0,
    w: 40,
    h: 14,
  });
  it('占位：强制四级必画、相交即跳过、次序稳定（与输入顺序无关）', () => {
    const cands = [
      c('low', 4, 10, 1),
      c('hi-deg', 4, 20, 9),
      c('hover', 0, 15),
      c('self', 2, 12),
      c('far', 4, 500),
    ];
    const a = placeLabels(cands);
    expect(a).toEqual(['hover', 'self', 'far']);
    expect(placeLabels([...cands].reverse())).toEqual(a);
    // 无强制项时：度数高者先占
    expect(placeLabels([c('low', 4, 10, 1), c('hi-deg', 4, 20, 9)])).toEqual(['hi-deg']);
  });
});

describe('㉒ graph-camera', () => {
  it('屏 ↔ 世界互逆；以点缩放保持不动点并限幅；平移', () => {
    const cam = { x: 100, y: 50, k: 2 };
    const s = toScreen(cam, 10, -5);
    expect(toWorld(cam, s.x, s.y)).toEqual({ x: 10, y: -5 });
    const z = zoomAt(cam, 300, 200, 1.5);
    const before = toWorld(cam, 300, 200);
    const after = toWorld(z, 300, 200);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomAt(cam, 0, 0, 100).k).toBe(4);
    expect(zoomAt(cam, 0, 0, 0.001).k).toBe(0.2);
    expect(panBy(cam, 5, -5)).toEqual({ x: 105, y: 45, k: 2 });
  });

  it('fit：8% 边距、上限 1.6、居中；centerOn；包围盒计入外扩', () => {
    const view = { w: 1000, h: 500 };
    const f = fitBounds({ minX: -100, minY: -50, maxX: 100, maxY: 50 }, view);
    expect(f.k).toBeCloseTo(Math.min(1.6, (500 * 0.84) / 100));
    expect(toScreen(f, 0, 0)).toEqual({ x: 500, y: 250 });
    const tiny = fitBounds({ minX: -1, minY: -1, maxX: 1, maxY: 1 }, view);
    expect(tiny.k).toBe(1.6);
    const cc = centerOn({ x: 0, y: 0, k: 1 }, 50, 50, view, 1.6);
    expect(toScreen(cc, 50, 50)).toEqual({ x: 500, y: 250 });
    expect(boundsOf([{ x: 0, y: 0, padX: 30, padY: 10 }, { x: 100, y: 20 }])).toEqual({
      minX: -30,
      minY: -10,
      maxX: 100,
      maxY: 20,
    });
    const mid = lerpCamera({ x: 0, y: 0, k: 1 }, { x: 10, y: 20, k: 4 }, 0.5);
    expect(mid).toMatchObject({ x: 5, y: 10 });
    expect(mid.k).toBeCloseTo(2);
  });
});

describe('㉒ graph-layout', () => {
  it('孤岛：确定性、在主图包围圆外（不重叠）、位于右下', () => {
    const main = boundingCircle([
      { x: -50, y: 0, r: 5 },
      { x: 50, y: 20, r: 5 },
      { x: 0, y: -40, r: 5 },
    ]);
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const p1 = islandPositions(ids, main);
    expect(islandPositions(ids, main)).toEqual(p1);
    for (const p of p1.values()) {
      expect(Math.hypot(p.x - main.cx, p.y - main.cy)).toBeGreaterThan(main.r);
      expect(p.x).toBeGreaterThan(main.cx);
      expect(p.y).toBeGreaterThan(main.cy);
    }
    expect(islandPositions([], main).size).toBe(0);
  });

  it('新节点：落在已知邻居重心附近、确定性；无邻居 → 中心附近', () => {
    const p = initialPosition('user/people/新.md', [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
    expect(Math.hypot(p.x - 150, p.y - 100)).toBeLessThanOrEqual(18);
    expect(initialPosition('user/people/新.md', [{ x: 100, y: 100 }, { x: 200, y: 100 }])).toEqual(p);
    const q = initialPosition('x', [], { x: 10, y: 10 });
    expect(Math.hypot(q.x - 10, q.y - 10)).toBeLessThanOrEqual(60);
  });

  it('布局记忆：存 / 读往返（键带角色 id）；坏数据回空', () => {
    const mem = new Map<string, string>();
    const kv = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    savePositions(kv, 'furina', new Map([['a', { x: 1.234, y: -5 }]]));
    expect(mem.has(`${GRAPH_POS_PREFIX}furina`)).toBe(true);
    expect(loadPositions(kv, 'furina')).toEqual(new Map([['a', { x: 1.2, y: -5 }]]));
    expect(loadPositions(kv, 'other').size).toBe(0);
    mem.set(`${GRAPH_POS_PREFIX}bad`, '{oops');
    expect(loadPositions(kv, 'bad').size).toBe(0);
  });

  it('debounce：只执行最后一次', async () => {
    const got: number[] = [];
    const d = debounce((x: number) => got.push(x), 5);
    d(1);
    d(2);
    await new Promise((r) => setTimeout(r, 20));
    expect(got).toEqual([2]);
  });
});

describe('㉒ graph-sim', () => {
  const mk = (): SimNode[] => ['a', 'b', 'c', 'd'].map((id) => ({ id, r: 6 }));
  const links = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'c', target: 'a' },
    { source: 'a', target: 'x' }, // 指向不存在节点：忽略
  ];
  it('同输入两次运行坐标相等（确定性）；定型后已冷却', () => {
    const n1 = mk();
    const s1 = createSim(n1, links);
    settleSync(s1);
    const n2 = mk();
    settleSync(createSim(n2, links));
    expect(n1.map((p) => [p.x, p.y])).toEqual(n2.map((p) => [p.x, p.y]));
    expect(s1.alpha()).toBeLessThan(0.01);
  });

  it('pin 后坐标不动；unpin 解除；有存档坐标的节点起点不变', () => {
    const nodes = mk();
    const sim = createSim(nodes, links);
    settleSync(sim);
    const a = nodes[0]!;
    pin(sim, a, 500, 500);
    for (let i = 0; i < 30; i++) sim.tick();
    expect([a.x, a.y]).toEqual([500, 500]);
    unpin(sim, a);
    expect(a.fx).toBeNull();

    const next = mk();
    expect(mergePositions(new Map([['b', { x: 7, y: 8 }]]), next)).toBe(1);
    expect([next[1]!.x, next[1]!.y]).toEqual([7, 8]);
    expect(next[0]!.x).toBeUndefined();
  });
});

describe('㉒ latest-request', () => {
  it('旧号响应被丢弃', () => {
    const g = createLatestRequest();
    const a = g.next();
    const b = g.next();
    expect(g.isCurrent(a)).toBe(false);
    expect(g.isCurrent(b)).toBe(true);
    g.invalidate();
    expect(g.isCurrent(b)).toBe(false);
  });
});
