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
