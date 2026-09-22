/**
 * ⑱ 眨眼调度（spec §2.3，从 runtime.ts 抽出）——间隔随情绪、15% 双眨、扫视 30% 伴随、
 * sleepy 半闭地板；动作协同可临时压眼睑（eyesHalf / eyesClosed）。纯逻辑，now/rand 注入。
 * 眨眼形状：120ms 合 + 120ms 开（三角），与 M4 一致。
 */
export const BLINK = {
  halfMs: 120,
  interval: { min: 2000, max: 6000 },
  surprised: { min: 6000, max: 10000 },
  sleepy: { min: 1500, max: 3000 },
  doubleRatio: 0.15,
  doubleGapMs: 150,
  saccadeRatio: 0.3,
} as const;

export type BlinkNudge = 'blink' | 'eyesHalf' | 'eyesClosed';

export class BlinkScheduler {
  private readonly rand: () => number;
  private emotion = 'neutral';
  private nextAt: number;
  private blinkStart = -Infinity;
  private pendingDouble = false;
  private lidUntil = -Infinity;
  private lidLevel = 0;
  private lidStart = -Infinity;

  constructor(now: number, rand: () => number = Math.random) {
    this.rand = rand;
    this.nextAt = now + 1500; // 启动基线（M4）
  }

  setEmotion(name: string): void {
    this.emotion = name;
  }

  intervalFor(emotion = this.emotion): { min: number; max: number } {
    if (emotion === 'surprised') return BLINK.surprised;
    if (emotion === 'sleepy') return BLINK.sleepy;
    return BLINK.interval;
  }

  private schedule(now: number): void {
    const { min, max } = this.intervalFor();
    this.nextAt = now + min + this.rand() * (max - min);
  }

  /** 立即眨一次（协同 / 扫视伴随）。进行中则忽略。 */
  blinkNow(now: number): void {
    if (now - this.blinkStart < BLINK.halfMs * 2) return;
    this.blinkStart = now;
    this.pendingDouble = false;
  }

  /** 扫视跳变：30% 概率伴随眨眼。 */
  onSaccade(now: number): void {
    if (this.rand() < BLINK.saccadeRatio) this.blinkNow(now);
  }

  /** 动作协同：blink 立即眨；eyesHalf/eyesClosed 在 durMs 内压眼睑到 level。 */
  nudge(kind: BlinkNudge, now: number, durMs: number, level?: number): void {
    if (kind === 'blink') {
      this.blinkNow(now);
      return;
    }
    this.lidStart = now;
    this.lidUntil = now + durMs;
    this.lidLevel = kind === 'eyesClosed' ? 1 : (level ?? 0.5);
  }

  /** 每帧：返回 blink 权重 [0,1]（含 floor / 协同眼睑）。 */
  sample(now: number, floor = 0): number {
    // 到点起眨
    if (now >= this.nextAt && now - this.blinkStart >= BLINK.halfMs * 2) {
      this.blinkStart = now;
      this.pendingDouble = this.rand() < BLINK.doubleRatio;
      this.schedule(now);
    }
    const t = now - this.blinkStart;
    let v = 0;
    if (t < BLINK.halfMs * 2) {
      v = t < BLINK.halfMs ? t / BLINK.halfMs : 2 - t / BLINK.halfMs;
    } else if (this.pendingDouble && t >= BLINK.halfMs * 2 + BLINK.doubleGapMs) {
      this.pendingDouble = false;
      this.blinkStart = now;
    }
    // 协同眼睑：缓入缓出的平台（前后各 150ms）
    let lid = 0;
    if (now < this.lidUntil) {
      const ramp = 150;
      const a = Math.min(1, (now - this.lidStart) / ramp);
      const b = Math.min(1, (this.lidUntil - now) / ramp);
      lid = this.lidLevel * Math.min(a, b);
    }
    return Math.max(0, Math.min(1, Math.max(v, floor, lid)));
  }
}
