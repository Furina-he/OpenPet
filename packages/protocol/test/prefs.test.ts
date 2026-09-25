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
    expect(DEFAULT_PREFS['offline.fallbackMode']).toBe('ollama');
    expect(DEFAULT_PREFS['budget.warnAt']).toBe(80);
  });
  it('validates enum + range on new fields', () => {
    expect(PrefsSchema.shape['general.updateChannel'].safeParse('preview').success).toBe(true);
    expect(PrefsSchema.shape['general.updateChannel'].safeParse('nightly').success).toBe(false);
    expect(PrefsSchema.shape['privacy.contextWindow'].safeParse(0).success).toBe(false);
    expect(PrefsSchema.shape['budget.warnAt'].safeParse(150).success).toBe(false);
  });
  it('批次⑥ arch#4：旧单 provider 键已从 schema 删除（迁移器读原始 JSON，不依赖 schema）', () => {
    expect('model.activeProvider' in PrefsSchema.shape).toBe(false);
    expect('model.activeModel' in PrefsSchema.shape).toBe(false);
    expect('model.openaiBaseUrl' in PrefsSchema.shape).toBe(false);
    expect('model.ollamaBaseUrl' in PrefsSchema.shape).toBe(false);
  });
  it('㉑ Star 兼容宿主裁撤：star.* 已出 schema，旧文件里的残留键读盘即剥离（不致整份回落默认）', () => {
    expect('star.disabled' in PrefsSchema.shape).toBe(false);
    expect('star.pipIndexUrl' in PrefsSchema.shape).toBe(false);
    const r = PrefsSchema.safeParse({
      'star.disabled': ['checkin'],
      'star.pipIndexUrl': 'https://pypi.tuna.tsinghua.edu.cn/simple',
      'display.theme': 'dark',
    });
    expect(r.success).toBe(true);
    expect(r.success && 'star.disabled' in r.data).toBe(false);
    expect(r.success && r.data['display.theme']).toBe('dark');
  });
});

describe('⑱ 生命感 v2 prefs', () => {
  it('pet.lifeLayers / pet.beatGestures / pet.moodAffectsVoice 默认全开且为布尔', () => {
    expect(DEFAULT_PREFS['pet.lifeLayers']).toBe(true);
    expect(DEFAULT_PREFS['pet.beatGestures']).toBe(true);
    expect(DEFAULT_PREFS['pet.moodAffectsVoice']).toBe(true);
    expect(PrefsSchema.shape['pet.lifeLayers'].safeParse('yes').success).toBe(false);
  });
});

describe('㉓ 角色缩放 v2 + 位置记忆 prefs', () => {
  it('characterScales 默认空表；值夹 [0.5, 2]', () => {
    expect(DEFAULT_PREFS['display.characterScales']).toEqual({});
    const s = PrefsSchema.shape['display.characterScales'];
    expect(s.safeParse({ default: 1.25, miko: 0.5 }).success).toBe(true);
    expect(s.safeParse({ default: 2.5 }).success).toBe(false);
    expect(s.safeParse({ default: 0.4 }).success).toBe(false);
  });

  it('characterPlacement 默认空记录；rx / ry 限 0–1', () => {
    expect(DEFAULT_PREFS['display.characterPlacement']).toEqual({
      lastDisplayId: '',
      byDisplay: {},
      byResolution: {},
    });
    const p = PrefsSchema.shape['display.characterPlacement'];
    const ok = {
      lastDisplayId: '2528732444',
      byDisplay: { '2528732444': { rx: 0.9, ry: 1 } },
      byResolution: { '1920x1040': { rx: 0.9, ry: 1 } },
    };
    expect(p.safeParse(ok).success).toBe(true);
    expect(
      p.safeParse({ ...ok, byDisplay: { '2528732444': { rx: 1.2, ry: 1 } } }).success,
    ).toBe(false);
  });

  it('默认值每次解析都是新对象（写入方不会串改 DEFAULT_PREFS）', () => {
    const a = PrefsSchema.parse({});
    const b = PrefsSchema.parse({});
    expect(a['display.characterScales']).not.toBe(b['display.characterScales']);
    expect(a['display.characterPlacement']).not.toBe(b['display.characterPlacement']);
  });

  it('display.characterScale 保留（没单独设过大小的角色的初值）', () => {
    expect(DEFAULT_PREFS['display.characterScale']).toBe(1);
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

describe('PrefsSchema provider workbench (AstrBot 对齐)', () => {
  it('defaults sources/models=[] 与 default*ModelId=""', () => {
    expect(DEFAULT_PREFS['model.providerSources']).toEqual([]);
    expect(DEFAULT_PREFS['model.models']).toEqual([]);
    expect(DEFAULT_PREFS['model.defaultChatModelId']).toBe('');
    expect(DEFAULT_PREFS['model.defaultEmbeddingModelId']).toBe('');
    expect(DEFAULT_PREFS['model.defaultSttModelId']).toBe('');
    expect(DEFAULT_PREFS['model.defaultTtsModelId']).toBe('');
    expect(DEFAULT_PREFS['model.defaultRerankModelId']).toBe('');
    expect(DEFAULT_PREFS['model.defaultAgentModelId']).toBe('');
  });
  it('validates a source array via .shape', () => {
    expect(
      PrefsSchema.shape['model.providerSources'].safeParse([
        { id: 'openai-main', adapter: 'openai', capability: 'chat', apiBase: 'https://api.openai.com/v1' },
      ]).success,
    ).toBe(true);
    expect(
      PrefsSchema.shape['model.providerSources'].safeParse([
        { id: 'x', adapter: 'nope', capability: 'chat', apiBase: '' },
      ]).success,
    ).toBe(false);
  });
});
