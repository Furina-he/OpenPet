/**
 * ㉓ 命中重判的纯逻辑（spec §5，§R 教训：Codex 的 Windows 命中 bug 全出在「几何变了、命中没重算」）。
 * 窗口按脚底锚改尺寸时窗口原点会动，光标不动就没有 mousemove——旧的穿透态会一直挂着。
 * 坐标全程 CSS 像素（= DIP），读 drawing buffer 时才乘 pixelRatio（沿用 S1 的 DPI 换算）。
 */
export interface Point {
  x: number;
  y: number;
}

/** 屏幕光标 − 窗口原点 = client 坐标。 */
export function clientFromScreen(cursor: Point, windowOrigin: Point): Point {
  return { x: cursor.x - windowOrigin.x, y: cursor.y - windowOrigin.y };
}

/**
 * client 坐标 → drawing buffer 像素（GL 原点在左下，翻 y）。画布只占模型框：先减画布 rect，
 * 落在画布外（透明舞台边）→ null，调用方按 alpha 0（透明）处理。
 */
export function bufferPixel(
  client: Point,
  rect: { left: number; top: number; width: number; height: number },
  pixelRatio: number,
  buffer: { width: number; height: number },
): Point | null {
  const lx = client.x - rect.left;
  const ly = client.y - rect.top;
  if (lx < 0 || ly < 0 || lx >= rect.width || ly >= rect.height) return null;
  const x = Math.floor(lx * pixelRatio);
  const y = buffer.height - 1 - Math.floor(ly * pixelRatio);
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return null;
  return { x, y };
}

/**
 * 穿透切换冻结位：拖拽（S1：否则中途变穿透、mouseup 落到桌面）/ 滚轮手势（缩小后光标落到透明处，
 * 切成穿透会让后续滚轮漏给下层窗口）/ 全局穿透 A3（整窗穿透期间逐像素逻辑不得改回可点）。
 */
export type FreezeReason = 'drag' | 'wheel' | 'locked';

export class HitGate {
  private readonly on = new Set<FreezeReason>();

  get frozen(): boolean {
    return this.on.size > 0;
  }

  /** 返回 true = 这一下刚解冻（调用方应立即重判一次）。 */
  set(reason: FreezeReason, active: boolean): boolean {
    const was = this.frozen;
    if (active) this.on.add(reason);
    else this.on.delete(reason);
    return was && !this.frozen;
  }

  has(reason: FreezeReason): boolean {
    return this.on.has(reason);
  }
}
