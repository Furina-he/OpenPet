import { describe, it, expect } from 'vitest';
import { resolveMode } from '../../src/renderer/character/desktop-state';

describe('desktop-state（A4 模式优先级）', () => {
  it('优先级 hidden > focus > dnd > normal', () => {
    expect(resolveMode({ fullscreenHidden: true, focus: true, dnd: true })).toBe('hidden');
    expect(resolveMode({ fullscreenHidden: false, focus: true, dnd: true })).toBe('focus');
    expect(resolveMode({ fullscreenHidden: false, focus: false, dnd: true })).toBe('dnd');
    expect(resolveMode({ fullscreenHidden: false, focus: false, dnd: false })).toBe('normal');
  });
});
