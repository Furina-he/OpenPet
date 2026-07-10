import { describe, it, expect } from 'vitest';
import { durationMs, bubbleSide } from '../../src/renderer/character/bubble-timer';

describe('bubble-timer（A2 消失时长 + 方向）', () => {
  it('durationMs：3/5/8 转毫秒，always → null（常驻）', () => {
    expect(durationMs('3')).toBe(3000);
    expect(durationMs('5')).toBe(5000);
    expect(durationMs('8')).toBe(8000);
    expect(durationMs('always')).toBeNull();
  });
  it('bubbleSide：头顶空间够→above，不够→below', () => {
    expect(bubbleSide({ charTopY: 200, bubbleH: 80 })).toBe('above'); // 200>80
    expect(bubbleSide({ charTopY: 40, bubbleH: 80 })).toBe('below'); // 40<80
  });
});
