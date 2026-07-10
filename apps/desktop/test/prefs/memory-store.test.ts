import { describe, it, expect } from 'vitest';
import { MemoryPrefsStore } from '../../electron/main/prefs/memory-store';

describe('MemoryPrefsStore', () => {
  it('returns defaults when constructed empty', () => {
    const s = new MemoryPrefsStore();
    expect(s.getAll()['display.theme']).toBe('system');
  });

  it('overrides a single key on set, leaving others at default', () => {
    const s = new MemoryPrefsStore();
    s.set('display.theme', 'dark');
    expect(s.getAll()['display.theme']).toBe('dark');
    expect(s.getAll()['display.alwaysOnTop']).toBe(true);
  });

  it('seeds from a partial initial object', () => {
    const s = new MemoryPrefsStore({ 'display.theme': 'light' });
    expect(s.getAll()['display.theme']).toBe('light');
  });
});
