import { describe, it, expect } from 'vitest';
import { CueSchema, DEFAULT_CUES, mergeCues, type Cue } from '../src/interaction-cues.js';
import { CharacterManifestSchema } from '../src/character-manifest.js';
import { PrefsSchema } from '../src/prefs.js';
import { Methods } from '../src/methods.js';

describe('CueSchema / DEFAULT_CUES', () => {
  it('默认表覆盖 spec §4 事件集（抽查）', () => {
    const ons = DEFAULT_CUES.map((c) => c.on);
    for (const e of [
      'tap.head',
      'combo.head',
      'stroke.head',
      'chat.error',
      'idle.timeout',
      'greet.morning',
      'file.drop',
    ])
      expect(ons).toContain(e);
  });
  it('tap.head → happy + nuzzle，带 cooldown', () => {
    const c = DEFAULT_CUES.find((x) => x.on === 'tap.head')!;
    expect(c).toMatchObject({ emotion: 'happy', action: 'nuzzle' });
    expect(c.cooldownMs).toBeGreaterThan(0);
  });
});

describe('mergeCues（角色包覆盖）', () => {
  it('同 on 包优先，其余保留默认', () => {
    const pack: Cue[] = [CueSchema.parse({ on: 'tap.head', emotion: 'shy' })];
    const merged = mergeCues(DEFAULT_CUES, pack);
    expect(merged.find((c) => c.on === 'tap.head')!.emotion).toBe('shy');
    expect(merged.find((c) => c.on === 'tap.body')).toBeTruthy();
  });
});

describe('manifest.cues / prefs / RPC', () => {
  it('manifest 接受 cues 数组', () => {
    expect(
      CharacterManifestSchema.safeParse({
        id: 'a',
        name: 'A',
        version: '1',
        engine: 'vrm',
        model: 'm.vrm',
        cues: [{ on: 'tap.head', emotion: 'shy' }],
      }).success,
    ).toBe(true);
  });
  it('prefs pet.mood 默认 0、pet.lastGreet 默认空', () => {
    const p = PrefsSchema.parse({});
    expect(p['pet.mood']).toEqual({ value: 0, updatedAt: 0 });
    expect(p['pet.lastGreet']).toBe('');
  });
  it('character.gesture / pet.say 注册', () => {
    expect(
      Methods['character.gesture'].params.safeParse({ zone: 'head', kind: 'stroke' }).success,
    ).toBe(true);
    expect(Methods['pet.say'].params.safeParse({ text: '早安' }).success).toBe(true);
  });
});
