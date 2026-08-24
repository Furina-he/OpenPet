import { describe, it, expect } from 'vitest';
import {
  isSafeRelPath,
  BODY_FIELDS,
  BodyPackSchema,
  CharacterManifestObjectSchema,
  CharacterManifestSchema,
  CHARACTER_ID_RE,
  IDENTITY_FIELDS,
  SOUL_FIELDS,
  splitManifest,
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

// --- ⑰ 形象层市场化 ---

describe('灵魂 / 肉体切分线（唯一真源）', () => {
  it('三组常量恰好覆盖 manifest 全字段，且互不重叠（新增字段漏归类即红）', () => {
    const all = Object.keys(CharacterManifestObjectSchema.shape).sort();
    const classified = [...BODY_FIELDS, ...SOUL_FIELDS, ...IDENTITY_FIELDS];
    expect([...classified].sort()).toEqual(all);
    expect(new Set(classified).size).toBe(classified.length);
  });

  it('splitManifest 按线拆两半：肉体归 body、人设/音色/元数据归 soul，id 两边都不出现', () => {
    const m = CharacterManifestSchema.parse({
      id: 'miko',
      name: '巫女',
      version: '2.0',
      engine: 'vrm',
      model: 'miko.vrm',
      emotions: { happy: { happy: 1 } },
      actions: ['wave'],
      preview: 'p.png',
      voice: 'v-1',
      license: 'CC0-1.0',
      persona: { systemPrompt: '你是巫女。', beginDialogs: ['在吗', '嗯？'] },
    });
    const { body, soul } = splitManifest(m);
    expect(body).toEqual({
      engine: 'vrm',
      model: 'miko.vrm',
      emotions: { happy: { happy: 1 } },
      actions: ['wave'],
      preview: 'p.png',
    });
    expect(soul).toEqual({
      name: '巫女',
      version: '2.0',
      voice: 'v-1',
      license: 'CC0-1.0',
      persona: { systemPrompt: '你是巫女。', beginDialogs: ['在吗', '嗯？'] },
    });
    expect('id' in body).toBe(false);
    expect('id' in soul).toBe(false);
  });
});

describe('BodyPackSchema（.dsbody 的 body.json）', () => {
  const body = { id: 'knight', name: 'Knight', version: '1.0', engine: 'vrm', model: 'k.vrm' };

  it('parses a minimal body pack', () => {
    const b = BodyPackSchema.parse(body);
    expect(b.id).toBe('knight');
    expect(b.engine).toBe('vrm');
  });

  it('复用 manifest 字段定义：词表 / cues / 元数据照常，灵魂字段被剥掉', () => {
    const b = BodyPackSchema.parse({
      ...body,
      emotions: { happy: { happy: 1 } },
      actions: ['wave'],
      live2dEmotions: { happy: 'exp_01' },
      preview: 'preview.png',
      author: 'sculptor',
      license: 'CC-BY-4.0',
      tags: ['knight'],
      // 灵魂字段混进来 → 被剥离（肉体包内嵌 persona 那就是 full 包，spec §4）
      persona: { systemPrompt: '不该在这里', beginDialogs: ['x', 'y'] },
      voice: 'v-1',
    });
    expect(b.emotions).toEqual({ happy: { happy: 1 } });
    expect(b.live2dEmotions).toEqual({ happy: 'exp_01' });
    expect(b.license).toBe('CC-BY-4.0');
    expect('persona' in b).toBe(false);
    expect('voice' in b).toBe(false);
  });

  it('沿用 manifest 的路径与引擎约束（zip-slip / live2d 设置文件）', () => {
    expect(() => BodyPackSchema.parse({ ...body, model: '../sys.vrm' })).toThrow();
    expect(() => BodyPackSchema.parse({ ...body, preview: '/abs.png' })).toThrow();
    expect(() => BodyPackSchema.parse({ ...body, id: 'Big' })).toThrow();
    expect(() =>
      BodyPackSchema.parse({ ...body, engine: 'live2d', model: 'k.moc3' }),
    ).toThrow(/model3\.json/);
    expect(
      BodyPackSchema.parse({ ...body, engine: 'live2d', model: 'k.model3.json' }).engine,
    ).toBe('live2d');
  });
});
