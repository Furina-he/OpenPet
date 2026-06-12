/**
 * Idle 动画池（tech-design §7「Idle 行为」）：变体 = 低幅复用程序化动作库，
 * 按当前 intent（mood/energy）过滤子集；空匹配回退「无约束」通用集，
 * 池子永不为空。调度是纯步进：planNextIdle 给出下次触发时刻 + 变体。
 * 基础层（眨眼 + 呼吸）不在池里 —— 那是 runtime 常驻行为。
 */
import type { ActionName } from './actions';

export interface IdleVariant {
  id: string;
  action: ActionName;
  /** 动作幅度缩放（≤0.7，与显式 playAction 区分）。 */
  scale: number;
  durationMs: number;
  /** 约束：声明则仅在命中的 mood / energy 下入选。 */
  moods?: readonly string[];
  energies?: readonly string[];
}

export const IDLE_POOL: readonly IdleVariant[] = [
  { id: 'sway', action: 'fidget', scale: 0.35, durationMs: 2600 },
  { id: 'glance', action: 'tilt', scale: 0.45, durationMs: 2000 },
  { id: 'micro-nod', action: 'nod', scale: 0.3, durationMs: 1400 },
  { id: 'bounce', action: 'jump', scale: 0.35, durationMs: 1100, energies: ['high'] },
  { id: 'droop', action: 'sigh', scale: 0.55, durationMs: 2600, energies: ['low'] },
  { id: 'shy-fidget', action: 'fidget', scale: 0.6, durationMs: 2000, moods: ['shy'] },
  { id: 'perk-up', action: 'tilt', scale: 0.6, durationMs: 1600, moods: ['happy', 'curious'] },
];

export interface IdleIntent {
  mood: string;
  energy: string;
}

export function selectIdleVariants(intent: IdleIntent): IdleVariant[] {
  const matched = IDLE_POOL.filter((v) => {
    const moodOk = !v.moods || v.moods.includes(intent.mood);
    const energyOk = !v.energies || v.energies.includes(intent.energy);
    return moodOk && energyOk;
  });
  if (matched.length > 0) return matched;
  return IDLE_POOL.filter((v) => !v.moods && !v.energies);
}

export const IDLE_GAP_MIN_MS = 4_000;
export const IDLE_GAP_MAX_MS = 10_000;

export function planNextIdle(
  nowMs: number,
  subset: readonly IdleVariant[],
  rand: () => number = Math.random,
): { at: number; variant: IdleVariant } {
  const at = nowMs + IDLE_GAP_MIN_MS + rand() * (IDLE_GAP_MAX_MS - IDLE_GAP_MIN_MS);
  const variant = subset[Math.floor(rand() * subset.length)] ?? subset[0]!;
  return { at, variant };
}
