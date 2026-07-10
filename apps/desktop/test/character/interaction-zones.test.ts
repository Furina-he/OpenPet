import { describe, it, expect } from 'vitest';
import { tapZone, classifyPress } from '../../src/renderer/character/interaction-zones';

describe('interaction-zones（A1 命中分区 + 按压判定）', () => {
  it('tapZone：上 38% 为头，其余为身', () => {
    expect(tapZone(10, 480)).toBe('head'); // y=10/480 ≈ 2%
    expect(tapZone(170, 480)).toBe('head'); // ≈35%
    expect(tapZone(200, 480)).toBe('body'); // ≈42%
    expect(tapZone(470, 480)).toBe('body');
  });
  it('classifyPress：短按未移动=tap；超时或移动=非 tap', () => {
    expect(classifyPress({ downT: 0, upT: 150, moved: false }, 200)).toBe('tap');
    expect(classifyPress({ downT: 0, upT: 300, moved: false }, 200)).toBe('none'); // 超长按（拖拽阈）
    expect(classifyPress({ downT: 0, upT: 100, moved: true }, 200)).toBe('none'); // 移动过
  });
});
