/** A2 气泡：消失时长解析 + 定位（纯函数）。 */
import type { Prefs } from '@openpet/protocol';

export function durationMs(pref: Prefs['display.bubbleDuration']): number | null {
  return pref === 'always' ? null : Number(pref) * 1000;
}

/** ⑳ 贴轮廓：气泡顶 = 轮廓顶上方 8px，最低不小于窗口顶 12px（放不下就压在头上，同 VRM）。 */
export const BUBBLE_TOP_MIN = 12;
export const BUBBLE_GAP = 8;
export function bubbleTop(boxTop: number, bubbleH: number): number {
  return Math.max(BUBBLE_TOP_MIN, boxTop - bubbleH - BUBBLE_GAP);
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BubblePlacementInput {
  /** 轮廓顶（窗口坐标；VRM / Live2D = 模型框顶）。 */
  boxTop: number;
  bubbleW: number;
  bubbleH: number;
  windowW: number;
  windowH: number;
  /** 窗口左上角的屏幕坐标（DIP）。 */
  windowScreen: { x: number; y: number };
  /** 所在显示器工作区；null = 只按窗口定位。 */
  workArea: Rect | null;
}

/**
 * ㉓ 气泡定位（取代 bubbleSide：它读气泡**上一次**的位置，上下交替出现）。只看轮廓顶：
 * 纵向 = 贴轮廓顶上方且不高于工作区顶（窗口在屏顶时放不下就压在头上），也不出窗口底；
 * 横向 = 窗口居中后夹进「窗口 ∩ 工作区」的可见部分（可见区比气泡还窄时左对齐，先保开头能读）。
 */
export function placeBubble(p: BubblePlacementInput): { left: number; top: number } {
  let top = bubbleTop(p.boxTop, p.bubbleH);
  let left = (p.windowW - p.bubbleW) / 2;
  if (p.workArea) {
    top = Math.max(top, p.workArea.y - p.windowScreen.y);
    const visL = Math.max(0, p.workArea.x - p.windowScreen.x);
    const visR = Math.min(p.windowW, p.workArea.x + p.workArea.width - p.windowScreen.x);
    left = Math.max(visL, Math.min(left, visR - p.bubbleW));
  }
  top = Math.min(top, Math.max(BUBBLE_TOP_MIN, p.windowH - p.bubbleH - BUBBLE_TOP_MIN));
  // left 不取整：100% 下与本批前的 left:50% + translateX(-50%) 落在同一个亚像素位置
  return { left, top };
}
