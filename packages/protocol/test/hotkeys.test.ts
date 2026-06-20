import { describe, it, expect } from 'vitest';
import { validateAccelerator, findConflict } from '../src/hotkeys';

describe('hotkey-rules（J2 限制 + 冲突）', () => {
  it('拒绝单键 / 纯修饰 / ESC；接受 修饰+键', () => {
    expect(validateAccelerator('D').ok).toBe(false);
    expect(validateAccelerator('CommandOrControl').ok).toBe(false);
    expect(validateAccelerator('Escape').ok).toBe(false);
    expect(validateAccelerator('CommandOrControl+Shift+D').ok).toBe(true);
  });
  it('findConflict：同 accelerator 已被其它功能占用', () => {
    const map = { chat: 'CommandOrControl+Shift+D', openHub: 'CommandOrControl+Shift+,' };
    expect(findConflict(map, 'dnd', 'CommandOrControl+Shift+D')).toBe('chat');
    expect(findConflict(map, 'dnd', 'CommandOrControl+Shift+M')).toBeNull();
    expect(findConflict(map, 'chat', 'CommandOrControl+Shift+D')).toBeNull(); // 自己不算冲突
  });
});
