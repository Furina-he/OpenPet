/**
 * ⑱ 表情包络 + 心情基线（spec §2.1）——纯逻辑，无 DOM / three 依赖，可单测。
 *
 * 表情从"二值"（预设满强度 或 全零）改为：
 *   attack（起 180ms，easeOut，120ms 处过冲 8%）→ hold（保持到 release）
 *   → release（退 1200ms easeInOut 到基线）→ rest（跟随基线）
 * 基线 `baselineForMood(mood)` 随心情三档取表，切档时 2s 缓变。
 * `<emo:/>` 连发时重新起算（不排队）；触发全零目标（neutral）等价 release。
 */
import { moodBand } from '@openpet/protocol';

export type Weights = Record<string, number>;

export const ENVELOPE: {
  attackMs: number;
  overshootAtMs: number;
  overshoot: number;
  releaseMs: number;
  baselineMs: number;
} = {
  attackMs: 180,
  overshootAtMs: 120,
  overshoot: 0.08,
  releaseMs: 1200,
  baselineMs: 2000,
};

/** 心情三档 → 常驻基线权重（只作用于运行时词表内存在的 expression 名，构造时过滤）。 */
export function baselineForMood(mood: number): Weights {
  switch (moodBand(mood)) {
    case 'high':
      return { happy: 0.15, relaxed: 0.2 };
    case 'low':
      return { sad: 0.12 };
    default:
      return { relaxed: 0.08 };
  }
}

const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** attack 曲线：0→1.08（120ms，easeOut）→1.0（180ms，线性回落）→ 1 保持。 */
export function attackCurve(tMs: number): number {
  const { attackMs, overshootAtMs, overshoot } = ENVELOPE;
  if (tMs <= 0) return 0;
  if (tMs < overshootAtMs) return (1 + overshoot) * easeOutQuad(tMs / overshootAtMs);
  if (tMs < attackMs) return 1 + overshoot * (1 - (tMs - overshootAtMs) / (attackMs - overshootAtMs));
  return 1;
}

type Phase = 'rest' | 'attack' | 'release';

export class EmotionEnvelope {
  private readonly names: readonly string[];
  private phase: Phase = 'rest';
  private phaseStart = 0;
  /** attack/release 起点快照。 */
  private from: Weights = {};
  /** attack 目标（hold 值）。 */
  private target: Weights = {};
  private baseFrom: Weights = {};
  private baseTo: Weights = {};
  private baseStart = -Infinity;

  constructor(names: readonly string[]) {
    this.names = [...names];
    for (const n of this.names) {
      this.from[n] = 0;
      this.target[n] = 0;
      this.baseFrom[n] = 0;
      this.baseTo[n] = 0;
    }
  }

  /** 触发一个表情目标（词表外的名字丢弃）；全零目标 = release。 */
  trigger(target: Weights, now: number): void {
    const t = this.zeros();
    let any = false;
    for (const n of this.names) {
      const w = target[n];
      if (w !== undefined && w > 0) {
        t[n] = clamp01(w);
        any = true;
      }
    }
    if (!any) {
      this.release(now);
      return;
    }
    this.from = this.sample(now);
    this.target = t;
    this.phase = 'attack';
    this.phaseStart = now;
  }

  /** 退到基线（取代硬复位）；已在 release/rest 时重新起算不改语义。 */
  release(now: number): void {
    if (this.phase === 'rest') return;
    this.from = this.sample(now);
    this.phase = 'release';
    this.phaseStart = now;
  }

  /** 换基线：与当前目标相同则 no-op（调用方可高频重复调用），否则 2s 缓变。 */
  setBaseline(weights: Weights, now: number): void {
    const next = this.zeros();
    for (const n of this.names) next[n] = clamp01(weights[n] ?? 0);
    if (this.names.every((n) => next[n] === this.baseTo[n])) return;
    this.baseFrom = this.baseline(now);
    this.baseTo = next;
    this.baseStart = now;
  }

  /** 当前基线（缓变中）。 */
  baseline(now: number): Weights {
    const k = easeInOut(clamp01((now - this.baseStart) / ENVELOPE.baselineMs));
    const out = this.zeros();
    for (const n of this.names) {
      const a = this.baseFrom[n] ?? 0;
      const b = this.baseTo[n] ?? 0;
      out[n] = a + (b - a) * k;
    }
    return out;
  }

  currentPhase(): Phase {
    return this.phase;
  }

  /** 每帧采样：返回全部词表名的权重（[0,1]）。 */
  sample(now: number): Weights {
    const out = this.zeros();
    if (this.phase === 'rest') return this.baseline(now);
    const t = now - this.phaseStart;
    if (this.phase === 'attack') {
      const k = attackCurve(t);
      for (const n of this.names) {
        const a = this.from[n] ?? 0;
        const b = this.target[n] ?? 0;
        out[n] = clamp01(a + (b - a) * k);
      }
      return out;
    }
    // release：from → 实时基线
    const k = easeInOut(clamp01(t / ENVELOPE.releaseMs));
    const base = this.baseline(now);
    for (const n of this.names) {
      const a = this.from[n] ?? 0;
      const b = base[n] ?? 0;
      out[n] = clamp01(a + (b - a) * k);
    }
    if (t >= ENVELOPE.releaseMs) this.phase = 'rest';
    return out;
  }

  private zeros(): Weights {
    const z: Weights = {};
    for (const n of this.names) z[n] = 0;
    return z;
  }
}
