/** A2 气泡：消失时长解析 + 方向自适应（纯函数）。 */
import type { Prefs } from '@openpet/protocol';

export function durationMs(pref: Prefs['display.bubbleDuration']): number | null {
  return pref === 'always' ? null : Number(pref) * 1000;
}

/** 角色顶距屏顶 < 气泡高 → 上方放不下，翻到下方。 */
export function bubbleSide(p: { charTopY: number; bubbleH: number }): 'above' | 'below' {
  return p.charTopY >= p.bubbleH ? 'above' : 'below';
}
