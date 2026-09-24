import { describe, it, expect } from 'vitest';
import {
  CODEX_DEFAULT_MAPPING,
  CODEX_LAYOUT,
  SpriteResolveError,
  SpriteSheetSchema,
  durationsOf,
  frameRects,
  resolveSprite,
  spriteDeclaredVocab,
} from '../src/sprite-body';
import { BodyPackSchema, CharacterManifestSchema } from '../src/character-manifest';
import { DEFAULT_ACTIONS, DEFAULT_EMOTIONS, vocabOf } from '../src/persona-prompt-template';

describe('⑳ CODEX_LAYOUT（锁死官方 animation-rows.md 契约）', () => {
  it('8 列 × 9 行、格 192×208、标准图 1536×1872', () => {
    expect(CODEX_LAYOUT.columns).toBe(8);
    expect(CODEX_LAYOUT.rows).toBe(9);
    expect(CODEX_LAYOUT.cell).toEqual({ width: 192, height: 208 });
    expect(CODEX_LAYOUT.sheet).toEqual({ width: 1536, height: 1872 });
  });

  it.each([
    ['idle', 0, [280, 110, 110, 140, 140, 320], true],
    ['running-right', 1, [120, 120, 120, 120, 120, 120, 120, 220], true],
    ['running-left', 2, [120, 120, 120, 120, 120, 120, 120, 220], true],
    ['waving', 3, [140, 140, 140, 280], false],
    ['jumping', 4, [140, 140, 140, 140, 280], false],
    ['failed', 5, [140, 140, 140, 140, 140, 140, 140, 240], true],
    ['waiting', 6, [150, 150, 150, 150, 150, 260], true],
    ['running', 7, [120, 120, 120, 120, 120, 220], true],
    ['review', 8, [150, 150, 150, 150, 150, 280], true],
  ] as const)('%s：第 %i 行，逐帧时长与循环', (name, row, durations, loop) => {
    const s = CODEX_LAYOUT.states[name]!;
    expect(s.row).toBe(row);
    expect(s.col).toBe(0);
    expect(s.frames).toBe(durations.length);
    expect(s.durationsMs).toEqual(durations);
    expect(s.loop).toBe(loop);
  });

  it('恰好 9 个状态', () => {
    expect(Object.keys(CODEX_LAYOUT.states)).toHaveLength(9);
  });
});

describe('resolveSprite', () => {
  it('codex 预设展开：九行 + 默认映射 + 槽位 + 选项默认值', () => {
    const r = resolveSprite({ layout: 'codex' });
    expect(Object.keys(r.states)).toHaveLength(9);
    expect(r.cell).toBeNull();
    expect(r.emotions['thinking']).toEqual({ loop: 'review', speed: 1 });
    expect(r.emotions['happy']).toEqual({ enter: 'jumping', speed: 1 });
    expect(r.emotions['sleepy']).toEqual({ loop: 'idle', speed: 0.6 });
    expect(r.actions).toEqual(CODEX_DEFAULT_MAPPING.actions);
    expect(r.slots).toEqual({ idle: 'idle', dragLeft: 'running-left', dragRight: 'running-right' });
    expect(r).toMatchObject({
      smoothing: 'smooth',
      fit: 'contain',
      facing: 'front',
      flipToCursor: false,
      proceduralLife: true,
    });
  });

  it('作者覆盖合并：同名状态覆盖 / 新增状态 / 映射覆盖 / null 删除预设', () => {
    const r = resolveSprite({
      layout: 'codex',
      states: {
        idle: { row: 0, frames: 4, durationsMs: 200 },
        blush: { row: 3, col: 4, frames: 2, durationsMs: [100, 300], loop: false },
      },
      emotions: { shy: { loop: 'blush', speed: 2 }, sad: null },
      actions: { nod: 'blush', wave: null },
      slots: { talk: 'waiting' },
      smoothing: 'pixel',
    });
    expect(r.states['idle']).toEqual({ row: 0, col: 0, frames: 4, durationsMs: [200, 200, 200, 200], loop: true });
    expect(r.states['blush']).toEqual({ row: 3, col: 4, frames: 2, durationsMs: [100, 300], loop: false });
    expect(r.emotions['shy']).toEqual({ loop: 'blush', speed: 2 });
    expect('sad' in r.emotions).toBe(false);
    expect(r.actions['nod']).toBe('blush');
    expect('wave' in r.actions).toBe(false);
    expect(r.slots.talk).toBe('waiting');
    expect(r.slots.idle).toBe('idle');
    expect(r.smoothing).toBe('pixel');
  });

  it('映射指向不存在的状态 → 拒绝（带路径）', () => {
    expect(() => resolveSprite({ layout: 'codex', emotions: { happy: { loop: 'dance' } } })).toThrow(
      SpriteResolveError,
    );
    try {
      resolveSprite({ layout: 'codex', actions: { nod: 'nope' } });
    } catch (e) {
      expect((e as SpriteResolveError).path).toEqual(['actions', 'nod']);
    }
    expect(() => resolveSprite({ layout: 'codex', slots: { talk: 'nope' } })).toThrow(/nope/);
  });

  it('custom 缺 cell / states / slots.idle → 拒绝；齐全则无预设', () => {
    const states = { stand: { row: 0, frames: 2, durationsMs: 200 } };
    expect(() => resolveSprite({ states, slots: { idle: 'stand' } })).toThrow(/cell/);
    expect(() => resolveSprite({ cell: { width: 64, height: 64 }, slots: { idle: 'stand' } })).toThrow(/states/);
    expect(() => resolveSprite({ cell: { width: 64, height: 64 }, states })).toThrow(/idle/);
    const r = resolveSprite({ cell: { width: 64, height: 64 }, states, slots: { idle: 'stand' } });
    expect(r.layout).toBe('custom');
    expect(Object.keys(r.states)).toEqual(['stand']);
    expect(r.emotions).toEqual({});
    expect(r.actions).toEqual({});
  });
});

describe('SpriteSheetSchema', () => {
  it('durationsMs 数组长度必须 = frames；单帧 16–5000', () => {
    expect(() =>
      SpriteSheetSchema.parse({ states: { a: { row: 0, frames: 3, durationsMs: [100, 100] } } }),
    ).toThrow(/frames/);
    expect(() => SpriteSheetSchema.parse({ states: { a: { row: 0, frames: 1, durationsMs: 10 } } })).toThrow();
    expect(() => SpriteSheetSchema.parse({ states: { a: { row: 0, frames: 1, durationsMs: 6000 } } })).toThrow();
  });

  it('情绪映射至少要有 loop 或 enter；speed 0.25–4；允许 null', () => {
    expect(() => SpriteSheetSchema.parse({ emotions: { happy: { speed: 2 } } })).toThrow();
    expect(() => SpriteSheetSchema.parse({ emotions: { happy: { loop: 'idle', speed: 5 } } })).toThrow();
    expect(SpriteSheetSchema.parse({ emotions: { happy: null } }).emotions).toEqual({ happy: null });
  });

  it('不挂默认值：解析结果保持作者原文（换形象 / 编辑器写回不膨胀）', () => {
    expect(SpriteSheetSchema.parse({ layout: 'codex' })).toEqual({ layout: 'codex' });
  });
});

describe('manifest / BodyPack 的 sprite 引擎约束', () => {
  const base = { id: 'pixel-cat', name: '像素猫', version: '1.0', engine: 'sprite', model: 'spritesheet.webp' };

  it('接受 codex 图集（.png / .webp，大小写不敏感）', () => {
    const m = CharacterManifestSchema.parse({ ...base, sprite: { layout: 'codex', smoothing: 'pixel' } });
    expect(m.engine).toBe('sprite');
    expect(m.sprite).toEqual({ layout: 'codex', smoothing: 'pixel' });
    expect(CharacterManifestSchema.parse({ ...base, model: 'a.PNG', sprite: { layout: 'codex' } }).model).toBe('a.PNG');
  });

  it('sprite 必填 / model 后缀 / 展开失败 → 拒绝', () => {
    expect(() => CharacterManifestSchema.parse(base)).toThrow(/sprite/);
    expect(() => CharacterManifestSchema.parse({ ...base, model: 'a.gif', sprite: { layout: 'codex' } })).toThrow(
      /png/,
    );
    expect(() =>
      CharacterManifestSchema.parse({ ...base, sprite: { layout: 'codex', actions: { nod: 'dance' } } }),
    ).toThrow(/dance/);
    expect(() => CharacterManifestSchema.parse({ ...base, sprite: {} })).toThrow(/cell/);
  });

  it('非 sprite 引擎带 sprite 字段不报错（被忽略）', () => {
    expect(
      CharacterManifestSchema.parse({ ...base, engine: 'vrm', model: 'm.vrm', sprite: { layout: 'codex' } }).engine,
    ).toBe('vrm');
  });

  it('BodyPackSchema 接受 sprite 形象包并携带 sprite 字段', () => {
    const b = BodyPackSchema.parse({ ...base, sprite: { layout: 'codex' }, preview: 'p.png' });
    expect(b.sprite).toEqual({ layout: 'codex' });
    expect(() => BodyPackSchema.parse(base)).toThrow(/sprite/);
  });
});

describe('frameRects', () => {
  const codex = resolveSprite({ layout: 'codex' });

  it('标准 1536×1872：格 192×208，无 warning', () => {
    const f = frameRects(codex, 1536, 1872);
    expect(f.cell).toEqual({ width: 192, height: 208 });
    expect(f.columns).toBe(8);
    expect(f.rows).toBe(9);
    expect(f.warnings).toEqual([]);
    expect(f.states['idle']!.rects).toHaveLength(6);
    expect(f.states['review']!.rects[5]).toEqual({ x: 5 * 192, y: 8 * 208, w: 192, h: 208 });
    expect(f.states['running-right']!.durationsMs).toEqual(CODEX_LAYOUT.states['running-right']!.durationsMs);
  });

  it('2× 图集 3072×3744：格按比例放大', () => {
    const f = frameRects(codex, 3072, 3744);
    expect(f.cell).toEqual({ width: 384, height: 416 });
    expect(f.states['jumping']!.rects[1]).toEqual({ x: 384, y: 4 * 416, w: 384, h: 416 });
    expect(f.warnings).toEqual([]);
  });

  it('比例不符只 warn 照常切', () => {
    const f = frameRects(codex, 1600, 1872);
    expect(f.cell.width).toBe(200);
    expect(f.warnings.some((w) => w.includes('1536:1872'))).toBe(true);
    expect(f.states['idle']!.rects).toHaveLength(6);
  });

  it('越界帧丢弃（durations 同步截断）并记 warning', () => {
    const r = resolveSprite({
      cell: { width: 32, height: 32 },
      states: {
        stand: { row: 0, col: 2, frames: 4, durationsMs: [100, 110, 120, 130] },
        gone: { row: 5, frames: 2, durationsMs: 100 },
      },
      slots: { idle: 'stand' },
    });
    const f = frameRects(r, 128, 64); // 4 列 × 2 行
    expect(f.states['stand']!.rects.map((x) => x.x)).toEqual([64, 96]);
    expect(f.states['stand']!.durationsMs).toEqual([100, 110]);
    expect(f.states['gone']!.rects).toEqual([]);
    expect(f.warnings).toHaveLength(2);
  });

  it('durationsOf：单个数展开 / 数组原样', () => {
    expect(durationsOf({ frames: 3, durationsMs: 90 })).toEqual([90, 90, 90]);
    expect(durationsOf({ frames: 2, durationsMs: [1, 2] })).toEqual([1, 2]);
  });
});

describe('vocabOf（词表唯一真源）', () => {
  it('vrm / live2d：与本批前逐字一致（emotions 键 ?? 默认 / actions ?? 默认）', () => {
    expect(vocabOf({ engine: 'vrm' })).toEqual({ emotions: DEFAULT_EMOTIONS, actions: DEFAULT_ACTIONS });
    expect(
      vocabOf({ engine: 'vrm', emotions: { joy: { happy: 1 } }, actions: ['spin'] }),
    ).toEqual({ emotions: ['joy'], actions: ['spin'] });
    expect(vocabOf({ engine: 'live2d', emotions: { joy: { happy: 1 } } })).toEqual({
      emotions: ['joy'],
      actions: DEFAULT_ACTIONS,
    });
  });

  it('sprite：默认词表 ∪ 作者声明的映射键；预设系统词与 null 不进词表', () => {
    const v = vocabOf({
      engine: 'sprite',
      emotions: { ignored: { happy: 1 } },
      actions: ['ignored'],
      sprite: { layout: 'codex', emotions: { proud: { loop: 'jumping' }, sad: null }, actions: { dance: 'running' } },
    });
    expect(v.emotions).toEqual([...DEFAULT_EMOTIONS, 'proud']);
    expect(v.actions).toEqual([...DEFAULT_ACTIONS, 'dance']);
    expect(v.emotions).not.toContain('thinking');
    expect(v.actions).not.toContain('searching');
    expect(vocabOf({ engine: 'sprite', sprite: { layout: 'codex' } })).toEqual({
      emotions: [...DEFAULT_EMOTIONS],
      actions: [...DEFAULT_ACTIONS],
    });
  });

  it('spriteDeclaredVocab：缺省为空', () => {
    expect(spriteDeclaredVocab(undefined)).toEqual({ emotions: [], actions: [] });
  });
});
