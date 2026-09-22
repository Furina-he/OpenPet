/**
 * ⑱ 姿态层（spec §2.4）——情绪 → 慢变骨骼目标（600ms easeInOut），是动作结束后"回到的地方"，
 * 取代回到 T-pose 原点。表内置；manifest 覆盖归 follow-up。纯逻辑可单测。
 */
import { ZERO_OFFSETS, type BoneOffsets } from './actions';

export const POSTURE_MS = 600;

export const POSTURE_TABLE: Record<string, Partial<BoneOffsets>> = {
  shy: { headPitch: 0.08, spinePitch: 0.04, armRaiseL: -0.05, armRaiseR: -0.05 },
  angry: { spinePitch: -0.05, headPitch: -0.04 },
  sad: { spinePitch: 0.08, headPitch: 0.1 },
  sleepy: { spinePitch: 0.08, headPitch: 0.1 },
  confused: { spinePitch: 0.08, headPitch: 0.1 },
  happy: { spinePitch: -0.02, hipsY: 0.005 },
  surprised: { spinePitch: -0.04, headPitch: -0.06 },
};

/** 心情低落时的常驻微垂头 / 脊柱塌（无情绪时的姿态底色，spec §8.3）。 */
export const MOOD_LOW_POSTURE: Partial<BoneOffsets> = { headPitch: 0.05, spinePitch: 0.04 };

export function postureFor(emotion: string, mood: number): BoneOffsets {
  const base = POSTURE_TABLE[emotion] ?? {};
  const out: BoneOffsets = { ...ZERO_OFFSETS, ...base };
  if (mood < -0.3 && !POSTURE_TABLE[emotion]) {
    out.headPitch += MOOD_LOW_POSTURE.headPitch ?? 0;
    out.spinePitch += MOOD_LOW_POSTURE.spinePitch ?? 0;
  }
  return out;
}

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const KEYS = Object.keys(ZERO_OFFSETS) as Array<keyof BoneOffsets>;

export class PostureLayer {
  private from: BoneOffsets = { ...ZERO_OFFSETS };
  private to: BoneOffsets = { ...ZERO_OFFSETS };
  private start = -Infinity;
  private emotion = 'neutral';
  private mood = 0;

  /** 情绪或心情变化 → 从当前值缓动到新目标（目标相同则 no-op）。 */
  set(emotion: string, mood: number, now: number): void {
    const target = postureFor(emotion, mood);
    this.emotion = emotion;
    this.mood = mood;
    if (KEYS.every((k) => target[k] === this.to[k])) return;
    this.from = this.sample(now);
    this.to = target;
    this.start = now;
  }

  /** 临时覆盖（如 droop 动作期间 posture 临时 sad），下次 set 恢复。 */
  override(emotion: string, now: number): void {
    const target = postureFor(emotion, this.mood);
    if (KEYS.every((k) => target[k] === this.to[k])) return;
    this.from = this.sample(now);
    this.to = target;
    this.start = now;
  }

  currentEmotion(): string {
    return this.emotion;
  }

  sample(now: number): BoneOffsets {
    const k = easeInOut(Math.min(1, Math.max(0, (now - this.start) / POSTURE_MS)));
    const out: BoneOffsets = { ...ZERO_OFFSETS };
    for (const key of KEYS) out[key] = this.from[key] + (this.to[key] - this.from[key]) * k;
    return out;
  }
}
