import { describe, it, expect } from 'vitest';
import {
  isSafeRelPath,
  CharacterManifestSchema,
  CHARACTER_ID_RE,
} from '../src/character-manifest';

describe('isSafeRelPath', () => {
  it.each(['model.vrm', 'assets/model.vrm', 'a/b/c.png', 'idle_01.vrma'])(
    'accepts safe relative path %s',
    (p) => {
      expect(isSafeRelPath(p)).toBe(true);
    },
  );

  it.each([
    '', // 空
    '/abs/model.vrm', // 绝对路径
    'C:/win/model.vrm', // 盘符
    'C:\\win\\model.vrm', // 盘符 + 反斜杠
    '..', // 越级
    '../model.vrm', // 越级
    'a/../../b.vrm', // 中段越级
    'a/./b.vrm', // 当前段（规范化歧义，拒绝）
    'a//b.vrm', // 空段
    'a\\b.vrm', // 反斜杠（Windows 分隔符混入）
    'a/b.vrm/', // 尾空段
  ])('rejects unsafe path %s', (p) => {
    expect(isSafeRelPath(p)).toBe(false);
  });
});

describe('CHARACTER_ID_RE', () => {
  it('accepts lowercase ids and rejects others', () => {
    expect(CHARACTER_ID_RE.test('default')).toBe(true);
    expect(CHARACTER_ID_RE.test('miko-2')).toBe(true);
    expect(CHARACTER_ID_RE.test('Big')).toBe(false); // asset:// host 会被小写化，禁大写
    expect(CHARACTER_ID_RE.test('-x')).toBe(false);
    expect(CHARACTER_ID_RE.test('a b')).toBe(false);
    expect(CHARACTER_ID_RE.test('')).toBe(false);
  });
});

describe('CharacterManifestSchema', () => {
  const base = {
    id: 'default',
    name: '小灵',
    version: '0.1.0',
    engine: 'vrm',
    model: 'model.vrm',
  };

  it('parses a minimal manifest', () => {
    const m = CharacterManifestSchema.parse(base);
    expect(m.id).toBe('default');
    expect(m.engine).toBe('vrm');
  });

  it('parses optional emotions map and actions list', () => {
    const m = CharacterManifestSchema.parse({
      ...base,
      emotions: { happy: { happy: 1 }, shy: { happy: 0.45, relaxed: 0.55 } },
      actions: ['wave', 'nod'],
    });
    expect(m.emotions?.['shy']).toEqual({ happy: 0.45, relaxed: 0.55 });
    expect(m.actions).toEqual(['wave', 'nod']);
  });

  it('rejects model path traversal', () => {
    expect(() => CharacterManifestSchema.parse({ ...base, model: '../sys.vrm' })).toThrow();
    expect(() => CharacterManifestSchema.parse({ ...base, model: '/abs.vrm' })).toThrow();
  });

  it('rejects bad id / engine / weights', () => {
    expect(() => CharacterManifestSchema.parse({ ...base, id: 'Big' })).toThrow();
    expect(() => CharacterManifestSchema.parse({ ...base, engine: 'live2d' })).toThrow(); // V1+
    expect(() =>
      CharacterManifestSchema.parse({ ...base, emotions: { happy: { happy: 1.5 } } }),
    ).toThrow();
  });
});
