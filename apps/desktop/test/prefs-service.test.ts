import { describe, it, expect } from 'vitest';
import { createPrefsService } from '../electron/main/prefs-service';
import { MemoryPrefsStore } from '../electron/main/prefs/memory-store';
import { createPrefEffects } from '../electron/main/prefs/effects';

function make() {
  const store = new MemoryPrefsStore();
  const sent: Array<{ channel: string; params: any }> = [];
  const svc = createPrefsService({
    store,
    broadcast: (channel, params) => sent.push({ channel, params }),
    effects: createPrefEffects(),
  });
  return { store, sent, svc };
}

describe('prefs-service', () => {
  it('getAll returns the full prefs object', async () => {
    const { svc } = make();
    const all = await svc['app.prefs.getAll']({});
    expect(all['display.theme']).toBe('system');
  });

  it('set persists, then broadcasts app.prefs.changed with the parsed value', async () => {
    const { store, sent, svc } = make();
    const r = await svc['app.prefs.set']({ key: 'display.theme', value: 'dark' });
    expect(r).toEqual({ ok: true });
    expect(store.getAll()['display.theme']).toBe('dark');
    expect(sent).toContainEqual({
      channel: 'app.prefs.changed',
      params: { key: 'display.theme', value: 'dark' },
    });
  });

  it('rejects an unknown key with -32602', async () => {
    const { svc } = make();
    await expect(svc['app.prefs.set']({ key: 'bogus.key', value: 1 })).rejects.toMatchObject({
      code: -32602,
    });
  });

  it('rejects an invalid value with -32602 and does not persist', async () => {
    const { store, svc } = make();
    await expect(
      svc['app.prefs.set']({ key: 'display.theme', value: 'neon' }),
    ).rejects.toMatchObject({ code: -32602 });
    expect(store.getAll()['display.theme']).toBe('system');
  });
});
