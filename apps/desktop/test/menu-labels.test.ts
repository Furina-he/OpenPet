import { describe, it, expect } from 'vitest';
import { menuLabels } from '../electron/main/menu-labels.js';

describe('menuLabels', () => {
  it('zh/en 键集一致且非空', () => {
    const zh = menuLabels('zh-CN');
    const en = menuLabels('en');
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    Object.values(en).forEach((v) => expect(v.length).toBeGreaterThan(0));
  });
  it('未知语言回退中文', () => {
    expect(menuLabels('fr' as never)).toEqual(menuLabels('zh-CN'));
  });
});
