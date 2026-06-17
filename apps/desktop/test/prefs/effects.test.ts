import { describe, it, expect, vi } from 'vitest';
import { createPrefEffects, applyAllEffects } from '../../electron/main/prefs/effects';
import { DEFAULT_PREFS } from '@desksoul/protocol';

function fakeWin() {
  return {
    isDestroyed: () => false,
    setAlwaysOnTop: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
  };
}

describe('pref effects (D-series, with deps)', () => {
  it('launchAtLogin → setLoginItem', () => {
    const setLoginItem = vi.fn();
    const effects = createPrefEffects({ setLoginItem });
    effects['general.launchAtLogin']!(false);
    expect(setLoginItem).toHaveBeenCalledWith(false);
  });

  it('alwaysOnTop / clickThrough → character window', () => {
    const win = fakeWin();
    const effects = createPrefEffects({ characterWindow: () => win as never });
    effects['display.alwaysOnTop']!(true);
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true);
    effects['display.clickThrough']!(true);
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
  });

  it('window effects no-op safely when no character window', () => {
    const effects = createPrefEffects({ characterWindow: () => null });
    expect(() => effects['display.alwaysOnTop']!(true)).not.toThrow();
  });

  it('theme/lookAt/footGlow are NOT in the registry (renderer reacts to broadcast)', () => {
    const effects = createPrefEffects();
    expect(effects['display.theme']).toBeUndefined();
    expect(effects['display.lookAt']).toBeUndefined();
    expect(effects['display.footGlow']).toBeUndefined();
  });

  it('applyAllEffects sweeps current prefs, applying registered keys', () => {
    const win = fakeWin();
    const setLoginItem = vi.fn();
    const effects = createPrefEffects({ characterWindow: () => win as never, setLoginItem });
    applyAllEffects(effects, DEFAULT_PREFS);
    expect(setLoginItem).toHaveBeenCalledWith(DEFAULT_PREFS['general.launchAtLogin']);
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(DEFAULT_PREFS['display.alwaysOnTop']);
  });
});
