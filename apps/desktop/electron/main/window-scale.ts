/**
 * D4 角色缩放（50%–200%）的窗口几何 —— 纯函数，Electron 缝在 ipc-router。
 * 锚定底边中点：桌宠"站"在桌面上，缩放时脚底位置不漂移。
 */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const CHARACTER_BASE_SIZE = { width: 320, height: 480 } as const;

/** Hub（settings 窗）仪表盘布局的理想/最小尺寸——总览页 KPI+图表需要宽幅。 */
export const HUB_IDEAL_SIZE = { width: 1280, height: 832 } as const;
export const HUB_MIN_SIZE = { width: 960, height: 640 } as const;

/** Hub 初始尺寸：理想尺寸 clamp 进工作区（四周留 margin），但不低于最小可用尺寸。 */
export function hubWindowSize(
  workArea: { width: number; height: number },
  margin = 24,
): { width: number; height: number } {
  return {
    width: Math.max(
      HUB_MIN_SIZE.width,
      Math.min(HUB_IDEAL_SIZE.width, workArea.width - margin * 2),
    ),
    height: Math.max(
      HUB_MIN_SIZE.height,
      Math.min(HUB_IDEAL_SIZE.height, workArea.height - margin * 2),
    ),
  };
}

export function scaledBounds(
  current: Bounds,
  scale: number,
  base: { width: number; height: number } = CHARACTER_BASE_SIZE,
): Bounds {
  const width = Math.round(base.width * scale);
  const height = Math.round(base.height * scale);
  const centerX = current.x + current.width / 2;
  const bottom = current.y + current.height;
  return { x: Math.round(centerX - width / 2), y: Math.round(bottom - height), width, height };
}
