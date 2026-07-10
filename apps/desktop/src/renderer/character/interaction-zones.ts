/** A1 命中分区与按压判定（纯函数）。头/身按窗口高度比例分；tap = 短按未移动。 */
export type Zone = 'head' | 'body';
const HEAD_RATIO = 0.38;

export function tapZone(clientY: number, height: number): Zone {
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
