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

describe('PrefsSchema D-series expansion', () => {
  it('defaults the new D-series keys per §14.1', () => {
    expect(DEFAULT_PREFS['general.hour24']).toBe(true);
    expect(DEFAULT_PREFS['general.startupShow']).toBe('character+tray');
    expect(DEFAULT_PREFS['privacy.contextWindow']).toBe(20);
    expect(DEFAULT_PREFS['privacy.clipboard']).toBe(false);
    expect(DEFAULT_PREFS['model.activeProvider']).toBe('');
    expect(DEFAULT_PREFS['model.openaiBaseUrl']).toBe('https://api.openai.com/v1');
    expect(DEFAULT_PREFS['offline.fallbackMode']).toBe('ollama');
    expect(DEFAULT_PREFS['budget.warnAt']).toBe(80);
  });
  it('validates enum + range on new fields', () => {
    expect(PrefsSchema.shape['general.updateChannel'].safeParse('preview').success).toBe(true);
    expect(PrefsSchema.shape['general.updateChannel'].safeParse('nightly').success).toBe(false);
    expect(PrefsSchema.shape['privacy.contextWindow'].safeParse(0).success).toBe(false);
    expect(PrefsSchema.shape['budget.warnAt'].safeParse(150).success).toBe(false);
    expect(PrefsSchema.shape['model.openaiBaseUrl'].parse('https://relay.example.com/v1/')).toBe(
      'https://relay.example.com/v1',
    );
  });
});

describe('PrefsSchema onboarding flag (M7b-2)', () => {
  it('defaults onboarding.completed to false', () => {
    expect(DEFAULT_PREFS['onboarding.completed']).toBe(false);
  });
  it('validates onboarding.completed as boolean', () => {
    expect(PrefsSchema.shape['onboarding.completed'].safeParse(true).success).toBe(true);
    expect(PrefsSchema.shape['onboarding.completed'].safeParse('yes').success).toBe(false);
  });
});

describe('PrefsSchema bubbleDuration (M8b)', () => {
  it('默认 5s，枚举 3/5/8/always', () => {
    expect(DEFAULT_PREFS['display.bubbleDuration']).toBe('5');
    expect(PrefsSchema.shape['display.bubbleDuration'].safeParse('always').success).toBe(true);
    expect(PrefsSchema.shape['display.bubbleDuration'].safeParse('10').success).toBe(false);
  });
});

describe('PrefsSchema dnd/focus (M8b A4)', () => {
  it('dndManual/focusMode 默认 false', () => {
    expect(DEFAULT_PREFS['display.dndManual']).toBe(false);
    expect(DEFAULT_PREFS['display.focusMode']).toBe(false);
  });
});

describe('PrefsSchema hotkeys (M8c J2)', () => {
  it('hotkeys 默认值', () => {
    expect(DEFAULT_PREFS['hotkeys.chat']).toBe('CommandOrControl+Shift+D');
    expect(DEFAULT_PREFS['hotkeys.openHub']).toBe('CommandOrControl+Shift+,');
  });
});
