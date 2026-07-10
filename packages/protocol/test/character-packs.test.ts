import { describe, expect, it } from 'vitest';
import { CharacterManifestSchema, DEFAULT_PREFS, Methods } from '../src/index.js';

const BASE = { id: 'miko', name: '巫女', version: '1.0.0', engine: 'vrm', model: 'model.vrm' };

describe('批次④ manifest 扩展', () => {
  it('preview 须为安全相对路径', () => {
    expect(CharacterManifestSchema.safeParse({ ...BASE, preview: 'img/card.png' }).success).toBe(true);
    expect(CharacterManifestSchema.safeParse({ ...BASE, preview: '../evil.png' }).success).toBe(false);
    expect(CharacterManifestSchema.safeParse({ ...BASE, preview: 'C:/x.png' }).success).toBe(false);
  });
  it('包声明 persona：开场白须偶数', () => {
    expect(
      CharacterManifestSchema.safeParse({
        ...BASE,
        persona: { systemPrompt: '你是巫女。', beginDialogs: ['来了呀', '欢迎回来～'] },
      }).success,
    ).toBe(true);
    expect(
      CharacterManifestSchema.safeParse({
        ...BASE,
        persona: { systemPrompt: '你是巫女。', beginDialogs: ['单条'] },
      }).success,
    ).toBe(false);
  });
  it('prefs 默认 activeId=default；methods 注册齐全', () => {
    expect(DEFAULT_PREFS['character.activeId']).toBe('default');
    for (const m of [
      'character.list',
      'character.switch',
      'character.importPick',
      'character.importApply',
      'character.remove',
      'character.changed',
    ] as const)
      expect(Methods[m]).toBeDefined();
  });
});

describe('批次⑤ Live2D manifest', () => {
  it('engine=live2d 要求 model 为 .model3.json', () => {
    expect(
      CharacterManifestSchema.safeParse({ ...BASE, engine: 'live2d', model: 'hiyori.model3.json' })
        .success,
    ).toBe(true);
    expect(
      CharacterManifestSchema.safeParse({ ...BASE, engine: 'live2d', model: 'model.vrm' }).success,
    ).toBe(false);
    expect(CharacterManifestSchema.safeParse(BASE).success).toBe(true); // vrm 不受影响
  });
  it('live2dEmotions/live2dMotions 形状', () => {
    expect(
      CharacterManifestSchema.safeParse({
        ...BASE,
        engine: 'live2d',
        model: 'a.model3.json',
        live2dEmotions: { happy: 'exp_smile' },
        live2dMotions: { wave: { group: 'TapBody', index: 1 }, nod: { group: 'TapHead' } },
      }).success,
    ).toBe(true);
    expect(
      CharacterManifestSchema.safeParse({
        ...BASE,
        engine: 'live2d',
        model: 'a.model3.json',
        live2dEmotions: { '非法 名': 'x' },
      }).success,
    ).toBe(false); // 情绪键仍走 NAME_RE
  });
});
