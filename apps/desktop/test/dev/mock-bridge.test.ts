import { describe, it, expect } from 'vitest';
import { createMockBridge } from '../../src/renderer/dev/mock-bridge';

describe('dev mock bridge', () => {
  it('getAll returns default prefs', async () => {
    const b = createMockBridge();
    const prefs = (await b.rpc('app.prefs.getAll', {})) as Record<string, unknown>;
    expect(prefs['display.theme']).toBe('system');
  });
  it('set updates local prefs and emits app.prefs.changed to subscribers', async () => {
    const b = createMockBridge();
    const seen: unknown[] = [];
    b.on('app.prefs.changed', (p) => seen.push(p));
    await b.rpc('app.prefs.set', { key: 'display.theme', value: 'dark' });
    expect(seen).toEqual([{ key: 'display.theme', value: 'dark' }]);
    expect(
      ((await b.rpc('app.prefs.getAll', {})) as Record<string, unknown>)['display.theme'],
    ).toBe('dark');
  });
  it('on returns an unsubscribe', async () => {
    const b = createMockBridge();
    const seen: unknown[] = [];
    const off = b.on('app.prefs.changed', (p) => seen.push(p));
    off();
    await b.rpc('app.prefs.set', { key: 'display.theme', value: 'light' });
    expect(seen).toEqual([]);
  });
});
