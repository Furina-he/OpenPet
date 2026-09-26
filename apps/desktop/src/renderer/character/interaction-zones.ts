/**
 * A1 命中分区与按压判定（纯函数）。头/身按窗口高度比例分；tap = 短按未移动。
 * ⑳ 可选可见轮廓 box（sprite 不占满窗口）：有 box 时按轮廓内 38% 分；VRM / Live2D 不传，行为不变。
 */
export type Zone = 'head' | 'body';
const HEAD_RATIO = 0.38;

export interface ContentBox {
  top: number;
  bottom: number;
}

/**
 * ㉓ 分区 / 气泡用的轮廓（窗口坐标）：精灵可见轮廓（容器 = 模型框坐标）加模型框偏移；
 * 无精灵轮廓（VRM / Live2D）= 模型框本身。100% VRM / Live2D 模型框 = 整窗 → 与旧口径一致。
 */
export function windowContour(
  model: { x: number; y: number; width: number; height: number },
  sprite: ContentBox | null,
): ContentBox {
  return sprite
    ? { top: model.y + sprite.top, bottom: model.y + sprite.bottom }
    : { top: model.y, bottom: model.y + model.height };
}

export function tapZone(clientY: number, height: number, box?: ContentBox | null): Zone {
  if (box && box.bottom > box.top) {
    return (clientY - box.top) / (box.bottom - box.top) <= HEAD_RATIO ? 'head' : 'body';
  }
  return height > 0 && clientY / height <= HEAD_RATIO ? 'head' : 'body';
}

export interface Press {
  downT: number;
  upT: number;
  moved: boolean;
}
/** tap=短按未移动；超过长按阈（=拖拽）或移动过 → none。 */
export function classifyPress(p: Press, longPressMs: number): 'tap' | 'none' {
  if (p.moved) return 'none';
  return p.upT - p.downT < longPressMs ? 'tap' : 'none';
}

/** 长按（F-IT-01）：按下 ≥600ms、未移动、未抬起（由调用方定时器判定到点）。 */
export const LONG_PRESS_MS = 600;

/** 抚摸检测输入：hover 轨迹样本（不按键，避免与拖窗冲突）。 */
export interface HoverSample {
  x: number;
  t: number;
  head: boolean;
}

/** 抚摸（F-IT-01）：水平方向翻转 ≥3 次、总时长 <1500ms、限 head 区。 */
export function detectStroke(samples: HoverSample[]): boolean {
  if (samples.length < 4) return false;
  const span = samples[samples.length - 1]!.t - samples[0]!.t;
  if (span >= 1500 || !samples.every((s) => s.head)) return false;
  let flips = 0;
  let dir = 0;
  for (let i = 1; i < samples.length; i++) {
    const d = Math.sign(samples[i]!.x - samples[i - 1]!.x);
    if (d !== 0 && dir !== 0 && d !== dir) flips++;
    if (d !== 0) dir = d;
  }
  return flips >= 3;
}
