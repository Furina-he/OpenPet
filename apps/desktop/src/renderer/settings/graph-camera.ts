/**
 * ㉒ 图谱相机（spec §4.2 / §4.3；纯 TS）：screen = world·k + (x, y)。以点缩放（0.2–4）、平移、
 * 适配全部（包围盒计入标签宽度、8% 边距、适配缩放上限 1.6）、居中、补间插值。
 */
export interface Camera {
  x: number;
  y: number;
  k: number;
}
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 4;
export const FIT_MAX = 1.6;

const clampK = (k: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));

export function toScreen(c: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: wx * c.k + c.x, y: wy * c.k + c.y };
}

export function toWorld(c: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - c.x) / c.k, y: (sy - c.y) / c.k };
}

/** 以屏幕点 (sx, sy) 为不动点缩放。 */
export function zoomAt(c: Camera, sx: number, sy: number, factor: number): Camera {
  const k = clampK(c.k * factor);
  const w = toWorld(c, sx, sy);
  return { k, x: sx - w.x * k, y: sy - w.y * k };
}

export function panBy(c: Camera, dx: number, dy: number): Camera {
  return { ...c, x: c.x + dx, y: c.y + dy };
}

/** 世界点居中到视口中心；k 缺省不变。 */
export function centerOn(
  c: Camera,
  wx: number,
  wy: number,
  view: { w: number; h: number },
  k = c.k,
): Camera {
  const kk = clampK(k);
  return { k: kk, x: view.w / 2 - wx * kk, y: view.h / 2 - wy * kk };
}

/** 适配包围盒：留 margin（比例）边距，缩放不超过 maxK。空盒 → 原点居中。 */
export function fitBounds(
  b: Bounds,
  view: { w: number; h: number },
  margin = 0.08,
  maxK = FIT_MAX,
): Camera {
  const bw = Math.max(1, b.maxX - b.minX);
  const bh = Math.max(1, b.maxY - b.minY);
  const aw = view.w * (1 - 2 * margin);
  const ah = view.h * (1 - 2 * margin);
  const k = clampK(Math.min(maxK, aw / bw, ah / bh));
  return centerOn({ x: 0, y: 0, k }, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, view, k);
}

/** 点集包围盒；pad(id) 给每点额外的四向外扩（半径 / 标签半宽）。 */
export function boundsOf(
  pts: ReadonlyArray<{ x: number; y: number; padX?: number; padY?: number }>,
): Bounds {
  if (pts.length === 0) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    const px = p.padX ?? 0;
    const py = p.padY ?? 0;
    minX = Math.min(minX, p.x - px);
    maxX = Math.max(maxX, p.x + px);
    minY = Math.min(minY, p.y - py);
    maxY = Math.max(maxY, p.y + py);
  }
  return { minX, minY, maxX, maxY };
}

/** 相机补间：缩放按对数插值（视觉匀速）。 */
export function lerpCamera(a: Camera, b: Camera, t: number): Camera {
  const e = t >= 1 ? 1 : t <= 0 ? 0 : t;
  return {
    x: a.x + (b.x - a.x) * e,
    y: a.y + (b.y - a.y) * e,
    k: Math.exp(Math.log(a.k) + (Math.log(b.k) - Math.log(a.k)) * e),
  };
}

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
