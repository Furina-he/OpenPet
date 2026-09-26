/**
 * ㉓ 视线 / 靠近 / 朝向用的「角色矩形」= 模型框的屏幕矩形（DIP）。窗口多出的透明舞台边不算角色——
 * 小尺寸时窗口 = 最小画布，按整窗口算视线中心会偏到头顶上方。
 */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function modelScreenRect(container: HTMLElement): ScreenRect {
  const r = container.getBoundingClientRect();
  return { x: window.screenX + r.left, y: window.screenY + r.top, width: r.width, height: r.height };
}
