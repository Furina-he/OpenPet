import { describe, it, expect } from 'vitest';
import { MOOD_HALF_LIFE_MS, MOOD_HIGH, MOOD_LOW, moodBand, moodCurrent } from '../src/mood';

describe('moodCurrent（⑱ Main / 渲染端唯一半衰公式）', () => {
  it('半衰：一个半衰期后 0.8 → 0.4，两个后 → 0.2', () => {
    expect(moodCurrent(0.8, 0, MOOD_HALF_LIFE_MS)).toBeCloseTo(0.4, 6);
    expect(moodCurrent(0.8, 0, 2 * MOOD_HALF_LIFE_MS)).toBeCloseTo(0.2, 6);
  });

  it('负值同样朝 0 回落', () => {
    expect(moodCurrent(-0.6, 0, MOOD_HALF_LIFE_MS)).toBeCloseTo(-0.3, 6);
  });

  it('clamp 到 [-1, 1]（坏输入不外溢）', () => {
    expect(moodCurrent(5, 0, 0)).toBe(1);
    expect(moodCurrent(-5, 0, 0)).toBe(-1);
  });

  it('时钟回拨（now < updatedAt）按 0 经过：原值不放大', () => {
    expect(moodCurrent(0.5, 10_000, 0)).toBe(0.5);
  });

  it('自定义半衰期', () => {
    expect(moodCurrent(1, 0, 1000, 1000)).toBeCloseTo(0.5, 6);
  });
});

describe('moodBand', () => {
  it('三档阈值：>0.4 high / <-0.3 low / 其余 neutral（边界归 neutral）', () => {
    expect(moodBand(0.9)).toBe('high');
    expect(moodBand(MOOD_HIGH)).toBe('neutral');
    expect(moodBand(0)).toBe('neutral');
    expect(moodBand(MOOD_LOW)).toBe('neutral');
    expect(moodBand(-0.8)).toBe('low');
  });
});
