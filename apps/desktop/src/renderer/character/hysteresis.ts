export interface HysteresisThresholds {
  /** 进入实心区（停止穿透）需要的 alpha 下限（0–255）。 */
  enter: number;
  /** 已在实心区时，alpha 低于此值才退出（重新穿透）。 */
  exit: number;
}

/**
 * 双阈值迟滞决策：enter > exit 拉开间距，光标在角色边缘游走时穿透状态不抖动。
 * `last === false`（当前实心/可命中）→ 仅 alpha < exit 才切回穿透；
 * 否则（穿透中或初始）→ alpha < enter 即维持/进入穿透。
 */
export function nextIgnore(
  alpha: number,
  last: boolean | null,
  t: HysteresisThresholds,
): boolean {
  return last === false ? alpha < t.exit : alpha < t.enter;
}
