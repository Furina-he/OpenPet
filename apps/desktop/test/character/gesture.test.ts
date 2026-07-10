import { describe, it, expect } from 'vitest';
import {
  LONG_PRESS_MS,
  detectStroke,
  type HoverSample,
} from '../../src/renderer/character/interaction-zones';

/** 便捷构造：x 序列按 dt 间隔铺时间轴。 */
function samples(xs: number[], dt: number, head = true): HoverSample[] {
  return xs.map((x, i) => ({ x, t: i * dt, head }));
}

describe('长按常量（F-IT-01）', () => {
  it('LONG_PRESS_MS = 600', () => {
    expect(LONG_PRESS_MS).toBe(600);
  });
});

describe('detectStroke（hover 抚摸检测）', () => {
  it('head 区往复 4 折、1.2s 内 → true', () => {
    // x 往复：翻转 4 次（> ≥3），9 样本 × 150ms = 1.2s
    const s = samples([0, 20, 40, 20, 0, 20, 40, 20, 0], 150);
    expect(detectStroke(s)).toBe(true);
  });

  it('只有 2 折 → false', () => {
    const s = samples([0, 20, 40, 20, 0], 100); // 翻转 2 次
    expect(detectStroke(s)).toBe(false);
  });

  it('总时长 ≥1500ms → false', () => {
    const s = samples([0, 20, 40, 20, 0, 20, 40, 20, 0], 200); // 8×200 = 1.6s
    expect(detectStroke(s)).toBe(false);
  });

  it('混入 body 区样本 → false', () => {
    const s = samples([0, 20, 40, 20, 0, 20, 40, 20, 0], 150);
    s[3] = { ...s[3]!, head: false };
    expect(detectStroke(s)).toBe(false);
  });

  it('样本 <4 → false', () => {
    expect(detectStroke(samples([0, 20, 40], 100))).toBe(false);
  });
});
