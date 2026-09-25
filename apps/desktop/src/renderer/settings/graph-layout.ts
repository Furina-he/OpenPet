/**
 * ㉒ 图谱布局辅助（spec §4.2；纯 TS、确定性）：孤岛摆放（向日葵点阵放在主图包围圆右下外侧）/
 * 布局记忆（坐标按页路径存 localStorage，重开不重排）/ 新节点初始坐标（已知邻居重心 + 路径哈希偏移）。
 */

export interface Point {
  x: number;
  y: number;
}

/** FNV-1a 32 位（路径 → 确定性偏移）。 */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 由哈希得到的单位圆内偏移方向与幅度（0.5–1）。 */
function hashOffset(id: string, radius: number): Point {
  const h = hashString(id);
  const angle = ((h & 0xffff) / 0x10000) * Math.PI * 2;
  const mag = radius * (0.5 + ((h >>> 16) / 0x10000) * 0.5);
  return { x: Math.cos(angle) * mag, y: Math.sin(angle) * mag };
}

/** 点集的包围圆（包围盒中心 + 最远点距离 + 各点半径）。 */
export function boundingCircle(
  pts: ReadonlyArray<Point & { r?: number }>,
): { cx: number; cy: number; r: number } {
  if (pts.length === 0) return { cx: 0, cy: 0, r: 0 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  let r = 0;
  for (const p of pts) r = Math.max(r, Math.hypot(p.x - cx, p.y - cy) + (p.r ?? 0));
  return { cx, cy, r };
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * 孤立页收成一个岛：按给定次序（调用方按标题排好）排成向日葵点阵，整体放在主图包围圆的右下外侧
 * （不与主图重叠）。零散孤点不参与主图斥力，「适配全部」不会把主图缩得很小。
 */
export function islandPositions(
  ids: readonly string[],
  main: { cx: number; cy: number; r: number },
  spacing = 22,
): Map<string, Point> {
  const out = new Map<string, Point>();
  if (ids.length === 0) return out;
  const islandR = spacing * Math.sqrt(ids.length) + spacing / 2;
  const gap = spacing * 1.5;
  const d = main.r + gap + islandR;
  const ox = main.cx + d * Math.SQRT1_2;
  const oy = main.cy + d * Math.SQRT1_2;
  ids.forEach((id, i) => {
    const rr = spacing * Math.sqrt(i + 0.5);
    out.set(id, { x: ox + Math.cos(i * GOLDEN) * rr, y: oy + Math.sin(i * GOLDEN) * rr });
  });
  return out;
}

/**
 * 新节点初始坐标：已知邻居的重心 + 路径哈希决定的微小偏移（确定性）；没有已知邻居 → 中心附近。
 */
export function initialPosition(
  id: string,
  knownNeighbors: readonly Point[],
  center: Point = { x: 0, y: 0 },
): Point {
  if (knownNeighbors.length === 0) {
    const o = hashOffset(id, 60);
    return { x: center.x + o.x, y: center.y + o.y };
  }
  const cx = knownNeighbors.reduce((s, p) => s + p.x, 0) / knownNeighbors.length;
  const cy = knownNeighbors.reduce((s, p) => s + p.y, 0) / knownNeighbors.length;
  const o = hashOffset(id, 18);
  return { x: cx + o.x, y: cy + o.y };
}

// ---------- 布局记忆 ----------

export const GRAPH_POS_PREFIX = 'openpet.memory.graphPos.';

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export function loadPositions(store: KV, cid: string): Map<string, Point> {
  try {
    const raw = store.getItem(GRAPH_POS_PREFIX + cid);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, [number, number]>;
    const out = new Map<string, Point>();
    for (const [k, v] of Object.entries(obj))
      if (Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]))
        out.set(k, { x: v[0], y: v[1] });
    return out;
  } catch {
    return new Map();
  }
}

export function savePositions(store: KV, cid: string, pos: ReadonlyMap<string, Point>): void {
  const obj: Record<string, [number, number]> = {};
  for (const [k, p] of pos) obj[k] = [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
  try {
    store.setItem(GRAPH_POS_PREFIX + cid, JSON.stringify(obj));
  } catch {
    /* 配额满：放弃记忆，不影响使用 */
  }
}

/** 尾随防抖（定型后 / 拖拽结束后存坐标）。 */
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const call = (...a: A): void => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = undefined;
      fn(...a);
    }, ms);
  };
  call.cancel = (): void => {
    if (t) clearTimeout(t);
    t = undefined;
  };
  return call;
}
