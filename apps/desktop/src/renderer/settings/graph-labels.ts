/**
 * ㉒ 图谱标签占位（spec §4.2 标签避让 / §4.3 文字；照 LivingMemory #261 的思路，自写）：
 * 固定优先级依次占位（悬停 > 选中 > 「我」> 搜索 / 试一句命中 > 度数高 > 标题序），前四级强制画，
 * 其余与已占位标签框相交即本帧不画 → 优先级固定，缩放 / 平移时不闪。字号取整数（宽度缓存与实绘一致）。
 */

/** 屏幕字号：round(clamp(12·k, 10, 16)) px。 */
export function labelFontPx(k: number): number {
  return Math.round(Math.min(16, Math.max(10, 12 * k)));
}

const WIDE_RE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

/** 超过 maxUnits 个汉字宽（全角 = 1，半角 = 0.5）截断加「…」。 */
export function truncateLabel(title: string, maxUnits = 12): string {
  let units = 0;
  const chars = [...title];
  for (let i = 0; i < chars.length; i++) {
    units += WIDE_RE.test(chars[i]!) ? 1 : 0.5;
    if (units > maxUnits) return `${chars.slice(0, i).join('')}…`;
  }
  return title;
}

/** 文字宽度缓存（按 font|text）；measure 由 canvas 提供。 */
export function createWidthCache(measure: (font: string, text: string) => number) {
  const cache = new Map<string, number>();
  return (font: string, text: string): number => {
    const key = `${font}|${text}`;
    let w = cache.get(key);
    if (w === undefined) {
      w = measure(font, text);
      if (cache.size > 4000) cache.clear();
      cache.set(key, w);
    }
    return w;
  };
}

/** 优先级档：0 悬停 / 1 选中 / 2 「我」/ 3 搜索或试一句命中 → 强制画；4 其余。 */
export type LabelTier = 0 | 1 | 2 | 3 | 4;

export interface LabelCandidate {
  id: string;
  tier: LabelTier;
  degree: number;
  title: string;
  /** 屏幕坐标下的标签框（左上 + 宽高）。 */
  x: number;
  y: number;
  w: number;
  h: number;
}

const intersects = (a: LabelCandidate, b: LabelCandidate): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** 稳定排序：档位 → 度数降序 → 标题 → id。 */
export function sortCandidates(c: readonly LabelCandidate[]): LabelCandidate[] {
  return [...c].sort(
    (a, b) =>
      a.tier - b.tier ||
      b.degree - a.degree ||
      (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) ||
      (a.id < b.id ? -1 : 1),
  );
}

/** 依次占位；返回要画的 id（按占位次序）。屏幕网格做粗筛。 */
export function placeLabels(cands: readonly LabelCandidate[], cell = 64): string[] {
  const grid = new Map<string, LabelCandidate[]>();
  const cellsOf = (c: LabelCandidate): string[] => {
    const out: string[] = [];
    for (let gx = Math.floor(c.x / cell); gx <= Math.floor((c.x + c.w) / cell); gx++)
      for (let gy = Math.floor(c.y / cell); gy <= Math.floor((c.y + c.h) / cell); gy++)
        out.push(`${gx},${gy}`);
    return out;
  };
  const placed: string[] = [];
  for (const c of sortCandidates(cands)) {
    const cells = cellsOf(c);
    if (c.tier > 3) {
      const hit = cells.some((k) => grid.get(k)?.some((o) => intersects(o, c)));
      if (hit) continue;
    }
    for (const k of cells) {
      const arr = grid.get(k);
      if (arr) arr.push(c);
      else grid.set(k, [c]);
    }
    placed.push(c.id);
  }
  return placed;
}
