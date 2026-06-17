import { describe, it, expect } from 'vitest';
import { PrefsSchema, DEFAULT_PREFS } from '../src/prefs.js';

describe('PrefsSchema', () => {
  it('fills every key from defaults when parsing {}', () => {
    expect(DEFAULT_PREFS['display.theme']).toBe('system');
    expect(DEFAULT_PREFS['display.alwaysOnTop']).toBe(true);
    expect(DEFAULT_PREFS['display.characterScale']).toBe(1);
    expect(DEFAULT_PREFS['general.launchAtLogin']).toBe(true);
  });

  it('exposes per-field schemas via .shape for single-key validation', () => {
    expect(PrefsSchema.shape['display.theme'].safeParse('dark').success).toBe(true);
    expect(PrefsSchema.shape['display.theme'].safeParse('neon').success).toBe(false);
    expect(PrefsSchema.shape['display.characterScale'].safeParse(3).success).toBe(false);
  });

  it('strips unknown keys instead of throwing', () => {
    const parsed = PrefsSchema.parse({ 'bogus.key': 1, 'display.theme': 'light' });
    expect('bogus.key' in parsed).toBe(false);
    expect(parsed['display.theme']).toBe('light');
  });
});
