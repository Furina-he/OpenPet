/**
 * MoodState —— 桌宠情绪连续性（F-IT-05）。moodValue ∈ [-1,1]，事件加减，
 * 指数半衰 ~2h（lazy 计算，不起 timer）；持久化 prefs 键 `pet.mood`（重启保留）。
 * 纯逻辑，now 注入可测。
 */
export interface MoodDeps {
  getPref: () => { value: number; updatedAt: number };
  setPref: (v: { value: number; updatedAt: number }) => void;
  now?: () => number;
}

export const MOOD_HALF_LIFE_MS = 2 * 60 * 60_000;

/** 事件 → mood 增量（spec F-IT-05）。 */
export const MOOD_DELTAS = {
  tapHead: 0.08,
  combo: 0.15,
  stroke: 0.1,
  chatDone: 0.03,
  chatError: -0.05,
} as const;

const clamp = (v: number): number => Math.max(-1, Math.min(1, v));

export class MoodState {
  private readonly deps: MoodDeps;
  private readonly now: () => number;

  constructor(deps: MoodDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
  }

  /** lazy 半衰：v * 0.5^((now-updatedAt)/HALF_LIFE)，clamp [-1,1]。 */
  current(): number {
    const { value, updatedAt } = this.deps.getPref();
    const elapsed = Math.max(0, this.now() - updatedAt);
    return clamp(value * Math.pow(0.5, elapsed / MOOD_HALF_LIFE_MS));
  }

  /** current() + delta → 写回 {value, updatedAt: now}。 */
  bump(delta: number): void {
    this.deps.setPref({ value: clamp(this.current() + delta), updatedAt: this.now() });
  }
}
