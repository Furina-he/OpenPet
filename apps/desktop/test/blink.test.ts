import { describe, it, expect } from 'vitest';
import { BLINK, BlinkScheduler } from '../src/renderer/character/blink';

function sched(rands: number[] = [0.5]) {
  let i = 0;
  return new BlinkScheduler(0, () => rands[i++ % rands.length]!);
}

describe('BlinkScheduler', () => {
  it('启动 1.5s 后首眨：120ms 合到 1、240ms 开回 0', () => {
    const b = sched([0.99]); // 不双眨
    expect(b.sample(1499)).toBe(0);
    expect(b.sample(1500)).toBe(0);
    expect(b.sample(1500 + BLINK.halfMs)).toBeCloseTo(1, 6);
    expect(b.sample(1500 + BLINK.halfMs * 2)).toBeCloseTo(0, 6);
  });

  it('间隔按情绪：默认 2–6s / surprised 6–10s / sleepy 1.5–3s（固定 rand=0 取下界）', () => {
    const b = sched([0.99, 0]); // 第一 rand=双眨判定(不双眨)，第二=间隔
    b.sample(1500); // 首眨 → schedule：double=0.99(不)，gap=0 → +2000
    expect(b.sample(1500 + 2000 - 1)).toBe(0);
    expect(b.sample(1500 + 2000)).toBe(0); // 起眨帧
    expect(b.sample(1500 + 2000 + BLINK.halfMs)).toBeCloseTo(1, 6);
    expect(b.intervalFor('surprised')).toEqual(BLINK.surprised);
    expect(b.intervalFor('sleepy')).toEqual(BLINK.sleepy);
    expect(b.intervalFor('happy')).toEqual(BLINK.interval);
  });

  it('15% 双眨：rand<0.15 时 240ms+150ms 后再眨一次', () => {
    const b = sched([0.1, 0.5]); // 双眨命中
    b.sample(1500);
    b.sample(1500 + BLINK.halfMs * 2 + 10); // 眨完
    const second = 1500 + BLINK.halfMs * 2 + BLINK.doubleGapMs;
    b.sample(second);
    expect(b.sample(second + BLINK.halfMs)).toBeCloseTo(1, 6);
  });

  it('sleepy 地板：无眨眼时权重 = floor', () => {
    const b = sched([0.99]);
    expect(b.sample(100, 0.4)).toBe(0.4);
    b.sample(1500, 0.4); // 起眨帧
    expect(b.sample(1500 + BLINK.halfMs, 0.4)).toBeCloseTo(1, 6);
  });

  it('扫视伴随 30%：rand<0.3 立即眨，否则不眨', () => {
    const yes = sched([0.1]);
    yes.onSaccade(100);
    expect(yes.sample(100 + BLINK.halfMs)).toBeCloseTo(1, 6);
    const no = sched([0.9]);
    no.onSaccade(100);
    expect(no.sample(100 + BLINK.halfMs)).toBe(0);
  });

  it('nudge eyesHalf：150ms 缓入到 0.5 平台，到期缓出', () => {
    const b = sched([0.99]);
    b.nudge('eyesHalf', 0, 1000);
    expect(b.sample(150)).toBeCloseTo(0.5, 6);
    expect(b.sample(500)).toBeCloseTo(0.5, 6);
    expect(b.sample(925)).toBeCloseTo(0.25, 6);
    expect(b.sample(1001)).toBe(0);
    b.nudge('eyesClosed', 2000, 400);
    expect(b.sample(2200)).toBeCloseTo(1, 6);
  });
});
