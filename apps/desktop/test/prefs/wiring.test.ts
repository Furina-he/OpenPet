import { describe, it, expect } from 'vitest';
import { createRouter } from '../../electron/main/router';
import { createPrefsService } from '../../electron/main/prefs-service';
import { MemoryPrefsStore } from '../../electron/main/prefs/memory-store';
import { createPrefEffects } from '../../electron/main/prefs/effects';

describe('prefs RPC wired through createRouter', () => {
  it('dispatches app.prefs.set with Zod-validated params then broadcasts', async () => {
    const store = new MemoryPrefsStore();
    const sent: Array<{ channel: string; params: any }> = [];
    const router = createRouter<null>({
      ...createPrefsService({
        store,
        broadcast: (channel, params) => sent.push({ channel, params }),
        effects: createPrefEffects(),
      }),
    });
    const r = await router.dispatch('app.prefs.set', { key: 'display.theme', value: 'dark' }, null);
    expect(r).toEqual({ ok: true });
    expect(store.getAll()['display.theme']).toBe('dark');
    expect(sent[0]).toMatchObject({ channel: 'app.prefs.changed' });
  });

  it('router rejects malformed params before reaching the service (-32602)', async () => {
    const router = createRouter<null>({
      ...createPrefsService({
        store: new MemoryPrefsStore(),
        broadcast: () => {},
        effects: createPrefEffects(),
      }),
    });
    // 缺 value → params schema 违约
    await expect(
      router.dispatch('app.prefs.set', { key: 'display.theme' }, null),
    ).rejects.toMatchObject({
      code: -32602,
    });
  });
});
