/**
 * ⑱ 生命底噪层（spec §2.2）——呼吸 / 微噪 / 重心转移，常驻永不为零：这是"活着"的最低证明。
 * 纯逻辑：now/rand 注入，输出 BoneOffsets 偏移，由 runtime.ts 与姿态/动作/拖拽叠加。
 */
import { ZERO_OFFSETS, type BoneOffsets } from './actions';

export type Energy = 'low' | 'mid' | 'high';

export function asEnergy(v: string): Energy {
  return v === 'low' || v === 'high' ? v : 'mid';
}

/** 夜间（本地 23:00–06:00）energy 基线降一档（渲染端本地钟，无需 Main）。 */
export function nightEnergy(hour: number, energy: Energy): Energy {
  const night = hour >= 23 || hour < 6;
  if (!night) return energy;
  return energy === 'high' ? 'mid' : 'low';
}

export interface LifeContext {
  energy: Energy;
  /** 心情 [-1,1]。 */
  mood: number;
  /** chat.stream 活跃中（说话）。 */
  speaking: boolean;
  /** 当前情绪名（sleepy 时呼吸慢而深）。 */
  emotion: string;
}

// ---- 呼吸 ----
export const BREATH_HZ: Record<Energy, number> = { low: 0.18, mid: 0.25, high: 0.33 };
export const BREATH_AMP: Record<Energy, number> = { low: 0.015, mid: 0.022, high: 0.03 };
const BREATH_HIPS_Y = 0.002;

export function breathParams(ctx: LifeContext): { hz: number; amp: number } {
  let hz = BREATH_HZ[ctx.energy];
  let amp = BREATH_AMP[ctx.energy];
  if (ctx.emotion === 'sleepy') {
    hz *= 0.7;
    amp *= 1.3;
  }
  if (ctx.mood < -0.3) hz *= 0.85; // 低落：呼吸慢
  else if (ctx.mood > 0.4) hz *= 1.1;
  if (ctx.speaking) amp *= 0.6;
  return { hz, amp };
}

/** 相位累积的呼吸振荡器：频率变化时不跳相（换 energy 不会"抽一下"）。 */
export class Breath {
  private phase = 0;
  private last: number | null = null;

  sample(now: number, ctx: LifeContext): { chestPitch: number; hipsY: number } {
    const { hz, amp } = breathParams(ctx);
    const dt = this.last === null ? 0 : Math.min(200, Math.max(0, now - this.last));
    this.last = now;
    this.phase = (this.phase + (2 * Math.PI * hz * dt) / 1000) % (2 * Math.PI);
    const s = Math.sin(this.phase);
    return { chestPitch: s * amp, hipsY: s * BREATH_HIPS_Y };
  }
}

// ---- 微噪：3 个互质周期正弦叠加（廉价 1D 噪声）----
const NOISE_PERIODS_MS = [6100, 8700, 11300] as const;
export const MICRO_NOISE_AMP = { headYaw: 0.03, headRoll: 0.02, spineYaw: 0.01 } as const;

function noise1d(now: number, seed: number): number {
  let v = 0;
  for (let i = 0; i < NOISE_PERIODS_MS.length; i++) {
    v += Math.sin((2 * Math.PI * now) / NOISE_PERIODS_MS[i]! + seed * (i + 1) * 1.7);
  }
  return v / NOISE_PERIODS_MS.length; // ∈ [-1, 1]
}

export function microNoise(
  now: number,
  energy: Energy,
): { headYaw: number; headRoll: number; spineYaw: number } {
  const k = energy === 'high' ? 1.4 : 1;
  return {
    headYaw: noise1d(now, 0) * MICRO_NOISE_AMP.headYaw * k,
    headRoll: noise1d(now, 1) * MICRO_NOISE_AMP.headRoll * k,
    spineYaw: noise1d(now, 2) * MICRO_NOISE_AMP.spineYaw * k,
  };
}

// ---- 重心转移：每 8–20s 随机一次，0.8s 缓动到 ±0.012m + spineRoll ∓0.02，静止保持 ----
export const WEIGHT_SHIFT = { minGapMs: 8000, maxGapMs: 20000, easeMs: 800, hipsX: 0.012, spineRoll: 0.02 } as const;
const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class WeightShift {
  private side = 0; // -1 / 0 / 1
  private fromSide = 0;
  private shiftStart = -Infinity;
  private nextAt: number;
  constructor(
    now: number,
    private readonly rand: () => number = Math.random,
  ) {
    this.nextAt = now + this.gap();
  }

  private gap(): number {
    return WEIGHT_SHIFT.minGapMs + this.rand() * (WEIGHT_SHIFT.maxGapMs - WEIGHT_SHIFT.minGapMs);
  }

  sample(now: number): { hipsX: number; spineRoll: number } {
    if (now >= this.nextAt) {
      this.fromSide = this.side;
      // 换边或回中：从非零侧 50% 回中、50% 换到另一侧；从中间随机一侧
      const r = this.rand();
      this.side = this.side === 0 ? (r < 0.5 ? -1 : 1) : r < 0.5 ? 0 : -this.side;
      this.shiftStart = now;
      this.nextAt = now + this.gap();
    }
    const k = easeInOut(Math.min(1, Math.max(0, (now - this.shiftStart) / WEIGHT_SHIFT.easeMs)));
    const s = this.fromSide + (this.side - this.fromSide) * k;
    return { hipsX: s * WEIGHT_SHIFT.hipsX, spineRoll: -s * WEIGHT_SHIFT.spineRoll };
  }
}

/** BoneOffsets 逐通道相加（合成用）。 */
export function addOffsets(...list: Array<Partial<BoneOffsets>>): BoneOffsets {
  const out: BoneOffsets = { ...ZERO_OFFSETS };
  for (const o of list) {
    for (const k of Object.keys(o) as Array<keyof BoneOffsets>) out[k] += o[k] ?? 0;
  }
  return out;
}

/** 底噪层合成器（runtime 每帧调一次）。 */
export class LifeLayer {
  private readonly breath = new Breath();
  private readonly shift: WeightShift;
  constructor(now: number, rand: () => number = Math.random) {
    this.shift = new WeightShift(now, rand);
  }

  sample(now: number, ctx: LifeContext): BoneOffsets {
    return addOffsets(this.breath.sample(now, ctx), microNoise(now, ctx.energy), this.shift.sample(now));
  }
}
