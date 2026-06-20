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
