import { describe, it, expect } from 'vitest';
import { CHARACTER_BASE_SIZE, scaledBounds } from '../electron/main/window-scale';

describe('scaledBounds', () => {
  const cur = { x: 100, y: 200, width: 320, height: 480 }; // scale=1 站位

  it('base size matches the character window default', () => {
    expect(CHARACTER_BASE_SIZE).toEqual({ width: 320, height: 480 });
  });

  it('keeps bottom-center anchored at 50%', () => {
    const b = scaledBounds(cur, 0.5);
    expect(b).toEqual({ x: 180, y: 440, width: 160, height: 240 });
    // 底边中点不变：x+w/2 = 260, y+h = 680
    expect(b.x + b.width / 2).toBe(cur.x + cur.width / 2);
    expect(b.y + b.height).toBe(cur.y + cur.height);
  });

  it('keeps bottom-center anchored at 200%', () => {
    const b = scaledBounds(cur, 2);
    expect(b).toEqual({ x: -60, y: -280, width: 640, height: 960 });
  });

  it('is idempotent for repeated same-scale calls (anchored on current bounds)', () => {
    const once = scaledBounds(cur, 1.5);
    const twice = scaledBounds(once, 1.5);
    expect(twice).toEqual(once);
  });

  it('rounds to integers', () => {
    const b = scaledBounds(cur, 0.77);
    expect(Number.isInteger(b.x) && Number.isInteger(b.y)).toBe(true);
    expect(b.width).toBe(Math.round(320 * 0.77));
    expect(b.height).toBe(Math.round(480 * 0.77));
  });
});
