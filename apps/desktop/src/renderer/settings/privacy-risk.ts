import type { PrefKey } from '@desksoul/protocol';

/** §7.6 高风险系统访问：首启开启需二次确认（截屏/摄像头）。 */
const HIGH_RISK: ReadonlySet<string> = new Set(['privacy.screenshot', 'privacy.camera']);

export function isHighRisk(key: PrefKey): boolean {
  return HIGH_RISK.has(key);
}

/** 仅"高风险键 + 从关到开"时需二次确认（关闭/非高风险不需）。 */
export function needsConfirm(key: PrefKey, from: boolean, to: boolean): boolean {
  return isHighRisk(key) && !from && to;
}
