import { describe, it, expect, vi } from 'vitest';
import { toggleClickThroughPref, toggleDndPref } from '../electron/main/app-actions';

function fakeStore(init: Record<string, unknown>) {
  const state = { ...init };
  return {
    getAll: () => state as never,
    set: (k: string, v: unknown) => {
      state[k] = v;
    },
  };
}

describe('app-actions（A1/J1/J2 共享动作）', () => {
  it('toggleClickThroughPref：翻转 pref + 施加窗口 + 广播，返回新态', () => {
    const store = fakeStore({ 'display.clickThrough': false });
    const setIgnore = vi.fn();
    const win = { isDestroyed: () => false, setIgnoreMouseEvents: setIgnore };
    const broadcast = vi.fn();
    const next = toggleClickThroughPref({
      prefsStore: store as never,
      characterWindow: () => win as never,
      broadcast,
    });
    expect(next).toBe(true);
    expect(store.getAll()['display.clickThrough']).toBe(true);
    expect(setIgnore).toHaveBeenCalledWith(true, { forward: true });
    expect(broadcast).toHaveBeenCalledWith('app.prefs.changed', {
      key: 'display.clickThrough',
      value: true,
    });
  });
  it('toggleDndPref：翻转 dndManual + 广播', () => {
    const store = fakeStore({ 'display.dndManual': true });
    const broadcast = vi.fn();
    const next = toggleDndPref({ prefsStore: store as never, broadcast });
    expect(next).toBe(false);
    expect(broadcast).toHaveBeenCalledWith('app.prefs.changed', {
      key: 'display.dndManual',
      value: false,
    });
  });
});
