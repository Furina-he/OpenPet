import { describe, it, expect, vi } from 'vitest';
import { createHotkeyService } from '../electron/main/hotkey-service';

function fakeGS() {
  const reg: Record<string, () => void> = {};
  return {
    register: vi.fn((acc: string, cb: () => void) => {
      reg[acc] = cb;
      return true;
    }),
    unregisterAll: vi.fn(() => {
      for (const k of Object.keys(reg)) delete reg[k];
    }),
    _fire: (acc: string) => reg[acc]?.(),
  };
}

describe('hotkey-service', () => {
  it('按 prefs 注册全部有效热键，触发调对应动作', () => {
    const gs = fakeGS();
    const actions = {
      chat: vi.fn(),
      toggleHide: vi.fn(),
      clickThrough: vi.fn(),
      dnd: vi.fn(),
      openHub: vi.fn(),
    };
    const svc = createHotkeyService({ globalShortcut: gs, actions });
    svc.apply({
      'hotkeys.chat': 'CommandOrControl+Shift+D',
      'hotkeys.openHub': 'CommandOrControl+Shift+,',
      'hotkeys.toggleHide': 'CommandOrControl+Shift+H',
      'hotkeys.clickThrough': 'CommandOrControl+Shift+P',
      'hotkeys.dnd': 'CommandOrControl+Shift+M',
    } as never);
    expect(gs.register).toHaveBeenCalledTimes(5);
    gs._fire('CommandOrControl+Shift+D');
    expect(actions.chat).toHaveBeenCalled();
  });
  it('apply 先 unregisterAll 再注册（重注册幂等）', () => {
    const gs = fakeGS();
    const actions = {
      chat: vi.fn(),
      toggleHide: vi.fn(),
      clickThrough: vi.fn(),
      dnd: vi.fn(),
      openHub: vi.fn(),
    };
    const svc = createHotkeyService({ globalShortcut: gs, actions });
    svc.apply({ 'hotkeys.chat': 'CommandOrControl+Shift+D' } as never);
    svc.apply({ 'hotkeys.chat': 'CommandOrControl+Shift+J' } as never);
    expect(gs.unregisterAll).toHaveBeenCalled();
  });
});
