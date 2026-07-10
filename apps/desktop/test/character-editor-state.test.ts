/** ⑩.7 E4 编辑器草稿态：克隆/规范化/脏检查/客户端校验（Zod 全校验在 Main 侧）。 */
import { describe, expect, it } from 'vitest';
import type { CharacterManifest } from '@openpet/protocol';
import {
  cloneManifest,
  normalizeDraft,
  isDirty,
  validateDraft,
} from '../src/renderer/settings/character-editor-state.js';

const BASE: CharacterManifest = {
  id: 'miko',
  name: '巫女',
  version: '1.0.0',
  engine: 'vrm',
  model: 'model.vrm',
};

describe('normalizeDraft', () => {
  it('trim 字符串；空 optional 字段/空数组/空对象删除', () => {
    const d = cloneManifest(BASE);
    d.name = '  巫女·改  ';
    d.author = '  ';
    d.description = '';
    d.tags = ['  可爱 ', ''];
    d.emotions = {};
    d.actions = [];
    const n = normalizeDraft(d);
    expect(n.name).toBe('巫女·改');
    expect(n.author).toBeUndefined();
    expect(n.description).toBeUndefined();
    expect(n.tags).toEqual(['可爱']);
    expect(n.emotions).toBeUndefined();
    expect(n.actions).toBeUndefined();
  });
  it('persona：systemPrompt 空 → 整段删除', () => {
    const d = cloneManifest(BASE);
    d.persona = { systemPrompt: '  ', beginDialogs: [] };
    expect(normalizeDraft(d).persona).toBeUndefined();
    d.persona = { systemPrompt: '你是巫女', beginDialogs: ['来了', '欢迎'] };
    expect(normalizeDraft(d).persona?.systemPrompt).toBe('你是巫女');
  });
  it('cues：say 空白行删除；空表整字段删除', () => {
    const d = cloneManifest(BASE);
    d.cues = [{ on: 'tap.head', say: ['  ', ''] }];
    const n = normalizeDraft(d);
    expect(n.cues?.[0]).toEqual({ on: 'tap.head' });
    d.cues = [];
    expect(normalizeDraft(d).cues).toBeUndefined();
  });
});

describe('isDirty', () => {
  it('未改 → false；规范化等价改动（空格）→ false；实改 → true', () => {
    const d = cloneManifest(BASE);
    expect(isDirty(BASE, d)).toBe(false);
    d.name = ' 巫女 ';
    expect(isDirty(BASE, d)).toBe(false);
    d.name = '巫女·改';
    expect(isDirty(BASE, d)).toBe(true);
  });
  it('新增情绪映射 → true；删回 → false', () => {
    const d = cloneManifest(BASE);
    d.emotions = { happy: { happy: 1 } };
    expect(isDirty(BASE, d)).toBe(true);
    d.emotions = {};
    expect(isDirty(BASE, d)).toBe(false);
  });
});

describe('validateDraft', () => {
  it('name/version 必填；权重越界报字段错', () => {
    const d = cloneManifest(BASE);
    d.name = ' ';
    d.version = '';
    d.emotions = { happy: { happy: 1.5 } };
    const errs = validateDraft(d);
    expect(errs['name']).toBeTruthy();
    expect(errs['version']).toBeTruthy();
    expect(errs['emotions']).toBeTruthy();
    expect(validateDraft(cloneManifest(BASE))).toEqual({});
  });
  it('tags 超 20 报错', () => {
    const d = cloneManifest(BASE);
    d.tags = Array.from({ length: 21 }, (_, i) => `t${i}`);
    expect(validateDraft(d)['tags']).toBeTruthy();
  });
});
