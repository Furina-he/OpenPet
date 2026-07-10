import { describe, it, expect, vi } from 'vitest';
import { createRouter } from '../../electron/main/router';
import { createPrefsService } from '../../electron/main/prefs-service';
import { createAppService } from '../../electron/main/app-service';
import { MemoryPrefsStore } from '../../electron/main/prefs/memory-store';
import { createPrefEffects } from '../../electron/main/prefs/effects';

describe('prefs + app RPC wired through createRouter', () => {
  it('set with a real effect applies the Main-side action', async () => {
    const store = new MemoryPrefsStore();
    const win = {
      isDestroyed: () => false,
      setAlwaysOnTop: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
    };
    const effects = createPrefEffects({ characterWindow: () => win as never });
    const router = createRouter<null>({
      ...createPrefsService({ store, broadcast: () => {}, effects }),
    });
    await router.dispatch('app.prefs.set', { key: 'display.alwaysOnTop', value: false }, null);
    expect(store.getAll()['display.alwaysOnTop']).toBe(false);
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(false);
  });

  it('routes app.openExternal through app-service', async () => {
    const opener = vi.fn();
    const router = createRouter<null>({ ...createAppService({ openExternal: opener }) });
    const r = await router.dispatch('app.openExternal', { url: 'https://x.dev' }, null);
    expect(r).toEqual({ ok: true });
    expect(opener).toHaveBeenCalledWith('https://x.dev');
  });
});
