/**
 * ⑱ 桌宠心情公式（Main / 渲染端唯一真源）。
 *
 * mood ∈ [-1, 1]，事件加减后按指数半衰 lazy 回落（不起 timer）。Main 侧 `MoodState`
 * 与 character 渲染端（表情基线 / 呼吸 / 姿态）都读同一个公式——两处不许各写一份。
 * 持久化形状 = prefs `pet.mood` 的 `{ value, updatedAt }`。
 */
export const MOOD_HALF_LIFE_MS = 2 * 60 * 60_000;

export const clampMood = (v: number): number => Math.max(-1, Math.min(1, v));

/**
 * 当前心情：`value · 0.5^((now − updatedAt) / halfLife)`，clamp [-1, 1]。
 * `now < updatedAt`（时钟回拨）按 0 经过处理 → 原值不放大。
 */
export function moodCurrent(
  value: number,
  updatedAt: number,
  now: number,
  halfLifeMs: number = MOOD_HALF_LIFE_MS,
): number {
  const elapsed = Math.max(0, now - updatedAt);
  return clampMood(value * Math.pow(0.5, elapsed / halfLifeMs));
}

/** 心情三档判定阈值（表情基线 / 心情句 / 语速共用）。 */
export const MOOD_HIGH = 0.4;
export const MOOD_LOW = -0.3;

export type MoodBand = 'high' | 'low' | 'neutral';

export function moodBand(mood: number): MoodBand {
  if (mood > MOOD_HIGH) return 'high';
  if (mood < MOOD_LOW) return 'low';
  return 'neutral';
}
