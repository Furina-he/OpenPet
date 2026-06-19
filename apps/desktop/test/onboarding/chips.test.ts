import { describe, it, expect } from 'vitest';
import { STARTER_CHIPS } from '../../src/renderer/onboarding/chips';

describe('C4 启动话术 chips', () => {
  it('固定 3–5 条、非空、不重复（§7.4）', () => {
    expect(STARTER_CHIPS.length).toBeGreaterThanOrEqual(3);
    expect(STARTER_CHIPS.length).toBeLessThanOrEqual(5);
    expect(STARTER_CHIPS.every((c) => c.trim().length > 0)).toBe(true);
    expect(new Set(STARTER_CHIPS).size).toBe(STARTER_CHIPS.length);
  });
  it('含设计稿示例话术', () => {
    expect(STARTER_CHIPS).toContain('早安！');
    expect(STARTER_CHIPS).toContain('给我讲个笑话');
    expect(STARTER_CHIPS).toContain('你叫什么名字');
  });
});
