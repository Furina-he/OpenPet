import { describe, it, expect } from 'vitest';
import { mouthValue, playbackRateOf } from '../src/renderer/character/mouth-drive.js';

describe('mouthValue（RMS×强度 → 口型 0–1）', () => {
  it('地板以下闭口；线性增益；clamp 1', () => {
    expect(mouthValue(0.01, 1)).toBe(0);
    expect(mouthValue(0.145, 1)).toBeCloseTo(1, 5); // (0.145-0.02)*8 = 1
    expect(mouthValue(0.9, 1)).toBe(1);
  });
  it('强度缩放：0 → 恒闭口；2 → 半音量即全开', () => {
    expect(mouthValue(0.5, 0)).toBe(0);
    expect(mouthValue(0.0825, 2)).toBeCloseTo(1, 5); // (0.0825-0.02)*8*2 = 1
    expect(mouthValue(0.05, 2)).toBeCloseTo(0.48, 5);
  });
});

describe('playbackRateOf（广播 rate → playbackRate）', () => {
  it('缺省/非法回 1；越界 clamp 0.5–2', () => {
    expect(playbackRateOf(undefined)).toBe(1);
    expect(playbackRateOf(Number.NaN)).toBe(1);
    expect(playbackRateOf(1.5)).toBe(1.5);
    expect(playbackRateOf(0.1)).toBe(0.5);
    expect(playbackRateOf(9)).toBe(2);
  });
});
