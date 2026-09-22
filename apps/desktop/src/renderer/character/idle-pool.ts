/**
 * Idle 动画池（tech-design §7「Idle 行为」）：变体 = 低幅复用程序化动作库，
 * 按当前 intent（mood/energy）过滤子集；空匹配回退「无约束」通用集，
 * 池子永不为空。调度是纯步进：planNextIdle 给出下次触发时刻 + 变体。
 * 基��层（眨眼 + 呼吸）不在池里 —— 那是 runtime 常驻行为。
 *
 * ⑱ 序列与权重（spec §2.6）：变体可带 `steps`（多步动作 + 间隙，scale 可负 = 反向），
 * `weight` 加权抽样；间隔随 energy（low 8–16s / mid 5–11s / high 3–8s）；
 * 新序列 look-around / glance-tilt-sigh（心情低落）/ stretch-yawn（低能量/夜间）/ perk（高能量）
 * + 低权重生活事件 shiver / hum（仅 voice.autoSpeak 关时；'hum' 是 runtime 的嘴部伪动作）。
 */
import type { ActionName } from './actions';
import type { Energy } from './life-layers';

export type IdleStepAction = ActionName | 'hum';

export interface IdleStep {
  action: IdleStepAction;
  /** 幅度（≤0.7；负值 = 反向，如 tilt 向另一侧）。 */
  scale: number;
  durationMs: number;
  /** 本步结束到下一步开始的间隙。 */
  gapMs: number;
}

export interface IdleVariant {
  id: string;
  action: ActionName;
  /** 动作幅度缩放（≤0.7，与显式 playAction 区分）。 */
  scale: number;
  durationMs: number;
  /** 约束：声明则仅在命中的 mood / energy 下入选。 */
  moods?: readonly string[];
  energies?: readonly string[];
  /** ⑱ 序列步（声明则忽略 action/scale/durationMs）。 */
  steps?: readonly IdleStep[];
  /** ⑱ 抽样权重（默认 1）。 */
  weight?: number;
  /** ⑱ 仅当心情数值 < moodMax 时入选。 */
  moodMax?: number;
  /** ⑱ 仅当 voice.autoSpeak 关时入选（hum 不与 TTS 抢嘴）。 */
  requiresNoAutoSpeak?: boolean;
}

export const IDLE_POOL: readonly IdleVariant[] = [
  { id: 'sway', action: 'fidget', scale: 0.35, durationMs: 2600 },
  { id: 'glance', action: 'tilt', scale: 0.45, durationMs: 2000 },
  { id: 'micro-nod', action: 'nod', scale: 0.3, durationMs: 1400 },
  { id: 'bounce', action: 'jump', scale: 0.35, durationMs: 1100, energies: ['high'] },
  { id: 'droop', action: 'sigh', scale: 0.55, durationMs: 2600, energies: ['low'] },
  { id: 'shy-fidget', action: 'fidget', scale: 0.6, durationMs: 2000, moods: ['shy'] },
  { id: 'perk-up', action: 'tilt', scale: 0.6, durationMs: 1600, moods: ['happy', 'curious'] },
  // ⑱ 序列
  {
    id: 'look-around',
    action: 'tilt',
    scale: 0.5,
    durationMs: 1400,
    steps: [
      { action: 'tilt', scale: 0.5, durationMs: 1400, gapMs: 250 },
      { action: 'tilt', scale: -0.5, durationMs: 1400, gapMs: 0 },
    ],
  },
  {
    id: 'glance-tilt-sigh',
    action: 'sigh',
    scale: 0.6,
    durationMs: 1800,
    moodMax: -0.3,
    steps: [
      { action: 'tilt', scale: 0.4, durationMs: 1200, gapMs: 200 },
      { action: 'sigh', scale: 0.6, durationMs: 1800, gapMs: 0 },
    ],
  },
  {
    id: 'stretch-yawn',
    action: 'stretch',
    scale: 0.6,
    durationMs: 2400,
    energies: ['low'],
    steps: [{ action: 'stretch', scale: 0.6, durationMs: 2400, gapMs: 0 }],
  },
  {
    id: 'perk',
    action: 'jump',
    scale: 0.35,
    durationMs: 700,
    energies: ['high'],
    steps: [
      { action: 'jump', scale: 0.35, durationMs: 700, gapMs: 150 },
      { action: 'wave', scale: 0.3, durationMs: 1200, gapMs: 0 },
    ],
  },
  // ⑱ 生活事件（低权重）
  {
    id: 'shiver',
    action: 'fidget',
    scale: 0.2,
    durationMs: 600,
    weight: 0.3,
    steps: [
      { action: 'fidget', scale: 0.2, durationMs: 600, gapMs: 100 },
      { action: 'fidget', scale: 0.2, durationMs: 600, gapMs: 0 },
    ],
  },
  {
    id: 'hum',
    action: 'fidget',
    scale: 0.1,
    durationMs: 2000,
    weight: 0.3,
    requiresNoAutoSpeak: true,
    steps: [{ action: 'hum', scale: 1, durationMs: 2000, gapMs: 0 }],
  },
];

export interface IdleIntent {
  mood: string;
  energy: string;
}

export interface IdleSelectContext {
  /** 心情数值 [-1,1]（moodMax 门）。 */
  moodValue?: number;
  /** voice.autoSpeak 开着 → 排除 requiresNoAutoSpeak 变体。 */
  autoSpeak?: boolean;
}

export function selectIdleVariants(intent: IdleIntent, ctx: IdleSelectContext = {}): IdleVariant[] {
  const gate = (v: IdleVariant): boolean => {
    if (v.moodMax !== undefined && !(ctx.moodValue !== undefined && ctx.moodValue < v.moodMax)) {
      return false;
    }
    if (v.requiresNoAutoSpeak && ctx.autoSpeak) return false;
    return true;
  };
  const matched = IDLE_POOL.filter((v) => {
    const moodOk = !v.moods || v.moods.includes(intent.mood);
    const energyOk = !v.energies || v.energies.includes(intent.energy);
    return moodOk && energyOk && gate(v);
  });
  if (matched.length > 0) return matched;
  return IDLE_POOL.filter((v) => !v.moods && !v.energies && gate(v));
}

/** ⑱ 间隔随 energy。 */
export const IDLE_GAPS: Record<Energy, { min: number; max: number }> = {
  low: { min: 8_000, max: 16_000 },
  mid: { min: 5_000, max: 11_000 },
  high: { min: 3_000, max: 8_000 },
};
export const IDLE_GAP_MIN_MS = IDLE_GAPS.mid.min;
export const IDLE_GAP_MAX_MS = IDLE_GAPS.mid.max;

/** 加权抽样（weight 默认 1）。 */
export function pickWeighted<T extends { weight?: number }>(items: readonly T[], r: number): T {
  const total = items.reduce((s, v) => s + (v.weight ?? 1), 0);
  let acc = r * total;
  for (const v of items) {
    acc -= v.weight ?? 1;
    if (acc < 0) return v;
  }
  return items[items.length - 1]!;
}

export function planNextIdle(
  nowMs: number,
  subset: readonly IdleVariant[],
  rand: () => number = Math.random,
  energy: Energy = 'mid',
): { at: number; variant: IdleVariant } {
  const gap = IDLE_GAPS[energy];
  const at = nowMs + gap.min + rand() * (gap.max - gap.min);
  const variant = pickWeighted(subset, rand());
  return { at, variant };
}

/** 变体 → 步骤列表（单动作变体也统一成一步）。 */
export function stepsOf(v: IdleVariant): readonly IdleStep[] {
  return v.steps ?? [{ action: v.action, scale: v.scale, durationMs: v.durationMs, gapMs: 0 }];
}

/**
 * ⑱ 序列步进器：runtime 每帧问 `next(now, busy)`；gap 内不被 idle 抢占（active 为真），
 * 显式动作到来即 `abort()` 中止序列。纯逻辑可单测。
 */
export class IdleSequencer {
  private steps: readonly IdleStep[] = [];
  private idx = 0;
  private notBefore = -Infinity;

  get active(): boolean {
    return this.idx < this.steps.length;
  }

  start(steps: readonly IdleStep[], now: number): void {
    this.steps = steps;
    this.idx = 0;
    this.notBefore = now;
  }

  abort(): void {
    this.steps = [];
    this.idx = 0;
  }

  /** 下一步到点且播放器空闲 → 返回该步并推进（调用方负责 play）；否则 null。 */
  next(now: number, playerBusy: boolean): IdleStep | null {
    if (!this.active || playerBusy || now < this.notBefore) return null;
    const step = this.steps[this.idx]!;
    this.idx += 1;
    this.notBefore = now + step.durationMs + step.gapMs;
    return step;
  }
}
