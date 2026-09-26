/**
 * ㉓ Ctrl+滚轮缩放的纯逻辑（spec §2.1）：deltaY 累积成「格」、格 → 目标大小、胶囊文案。
 * 装配（监听 / 预览 RPC 合批 / 停手持久化 / 冻结穿透）在 main.ts。
 */

/** deltaY（像素模式）累积 100 = 一格 = ±5%。 */
export const NOTCH = 100;
export const WHEEL_STEP = 0.05;
/** 停手多久算手势结束（持久化 + 解冻穿透）。 */
export const WHEEL_SETTLE_MS = 500;
/** 胶囊停留时长。 */
export const HUD_HOLD_MS = 900;

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const SCALE_MIN = 0.5;
const EPS = 1e-6;
const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;

export class WheelScaler {
  private acc = 0;

  /**
   * 喂一个 wheel 事件，返回本次凑满的格数（正 = 放大 = 上滚）。行模式 3 行一格、页模式 1 页一格；
   * 单个事件至多记一格——高 DPI 下单格 deltaY 可能是 125 / 150，不截断会隔几格跳两档。
   */
  feed(deltaY: number, deltaMode: number): number {
    const px =
      deltaMode === DOM_DELTA_LINE
        ? deltaY * (NOTCH / 3)
        : deltaMode === DOM_DELTA_PAGE
          ? deltaY * NOTCH
          : deltaY;
    this.acc -= Math.max(-NOTCH, Math.min(NOTCH, px));
    const steps = Math.trunc(this.acc / NOTCH);
    this.acc -= steps * NOTCH;
    return steps;
  }

  reset(): void {
    this.acc = 0;
  }
}

export interface StepContext {
  pixelSnap: boolean;
  /** 像素模式的清晰档（Main layout.presets）。 */
  presets: number[];
  maxScale: number;
}

/**
 * 目标大小：常规 = ±5% 网格、夹 [0.5, maxScale]、≥ maxScale 取 maxScale（与 Main snapScale 同口径，
 * 手势中渲染端自己累计目标不等回包也不会漂）；像素 = 在 ≤ maxScale 的清晰档间跳，当前值不在档上
 * （换屏前的旧值）时按方向落到相邻档。
 */
export function stepScale(current: number, steps: number, ctx: StepContext): number {
  if (steps === 0) return current;
  if (!ctx.pixelSnap) {
    const raw = current + steps * WHEEL_STEP;
    if (raw >= ctx.maxScale - EPS) return ctx.maxScale;
    const grid = round4(Math.round(raw / WHEEL_STEP) * WHEEL_STEP);
    return Math.min(ctx.maxScale, Math.max(SCALE_MIN, grid));
  }
  const stops = ctx.presets.filter((v) => v <= ctx.maxScale + EPS);
  if (stops.length === 0) return current;
  const exact = stops.findIndex((v) => Math.abs(v - current) < 1e-3);
  let idx: number;
  if (exact >= 0) {
    idx = exact + steps;
  } else if (steps > 0) {
    const above = stops.findIndex((v) => v > current);
    idx = (above < 0 ? stops.length : above) + steps - 1;
  } else {
    let below = -1;
    stops.forEach((v, i) => {
      if (v < current) below = i;
    });
    idx = below + steps + 1;
  }
  return stops[Math.max(0, Math.min(stops.length - 1, idx))]!;
}

/** 胶囊 / 菜单文案：常规「120%」；像素「2× · 133%」（k = 设备像素倍数）。 */
export function scaleLabel(scale: number, pixelSnap: boolean, dpr: number): string {
  const pct = `${Math.round(scale * 100)}%`;
  return pixelSnap ? `${Math.max(1, Math.round(scale * dpr))}× · ${pct}` : pct;
}
