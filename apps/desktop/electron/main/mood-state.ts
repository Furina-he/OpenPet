/**
 * MoodState —— 桌宠情绪连续性（F-IT-05）。moodValue ∈ [-1,1]，事件加减，
 * 指数半衰 ~2h（lazy 计算，不起 timer）；持久化 prefs 键 `pet.mood`（重启保留）。
 * 纯逻辑，now 注入可测。
 */
import { MOOD_HALF_LIFE_MS, clampMood, moodCurrent } from '@openpet/protocol';

export interface MoodDeps {
  getPref: () => { value: number; updatedAt: number };
  setPref: (v: { value: number; updatedAt: number }) => void;
  now?: () => number;
}

export { MOOD_HALF_LIFE_MS };

/** 事件 → mood 增量（spec F-IT-05；⑱ 追加节拍感叹 / 连续冷落两项）。 */
export const MOOD_DELTAS = {
  tapHead: 0.08,
  combo: 0.15,
  stroke: 0.1,
  chatDone: 0.03,
  chatError: -0.05,
  /** ⑱ 段尾感叹号节拍（每轮至多计 1 次）。 */
  beatExclaim: 0.01,
  /** ⑱ idle.timeout 连续第 3 次起（长时间无人理）。 */
  idleLongNeglect: -0.04,
} as const;

const clamp = clampMood;

export class MoodState {
  private readonly deps: MoodDeps;
  private readonly now: () => number;

  constructor(deps: MoodDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
  }

  /** lazy 半衰（公式 = protocol `moodCurrent`，与渲染端同源）。 */
  current(): number {
    const { value, updatedAt } = this.deps.getPref();
    return moodCurrent(value, updatedAt, this.now());
  }

  /** current() + delta → 写回 {value, updatedAt: now}。 */
  bump(delta: number): void {
    this.deps.setPref({ value: clamp(this.current() + delta), updatedAt: this.now() });
  }
}
