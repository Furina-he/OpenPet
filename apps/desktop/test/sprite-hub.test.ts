/** ⑳ Hub 帧动画：引擎标签 / CSS 切帧数学 / 缩略图数据源 / 总览降级链 / E4 映射编辑往返。 */
import { describe, expect, it } from 'vitest';
import {
  BodyPackSchema,
  CharacterManifestSchema,
  resolveSprite,
  type CharacterManifest,
  type SpriteSheet,
} from '@openpet/protocol';
import { engineLabel } from '../src/renderer/settings/engine-label.js';
import {
  actionPreviewState,
  cellFromImage,
  emotionPreviewState,
  frameBackground,
  thumbScale,
  tryResolveSprite,
} from '../src/renderer/settings/sprite-thumb.js';
import { showcaseMode } from '../src/renderer/settings/overview-view.js';
import { toCardVm, withoutEmotionOverrides } from '../src/renderer/settings/character-library-view.js';
import { toBodyCard } from '../src/renderer/settings/body-view.js';
import {
  isDirty,
  normalizeDraft,
  normalizeSprite,
  setSpriteAction,
  setSpriteEmotion,
  setSpriteSlot,
  spriteActionNames,
  spriteEmotionNames,
  validateDraft,
} from '../src/renderer/settings/character-editor-state.js';

const SPRITE: CharacterManifest = CharacterManifestSchema.parse({
  id: 'pixel-cat',
  name: '像素猫',
  version: '1.0',
  engine: 'sprite',
  model: 'sheet.webp',
  sprite: { layout: 'codex', smoothing: 'pixel' },
});

describe('engineLabel', () => {
  const t = (k: string): string => `T(${k})`;
  it('已知引擎走 i18n，未知回退大写原串', () => {
    expect(engineLabel('sprite', t)).toBe('T(settings.characters.engines.sprite)');
    expect(engineLabel('vrm', t)).toBe('T(settings.characters.engines.vrm)');
    expect(engineLabel('live2d', t)).toBe('T(settings.characters.engines.live2d)');
    expect(engineLabel('voxel', t)).toBe('VOXEL');
  });
});

describe('sprite-thumb 纯逻辑', () => {
  const codex = resolveSprite({ layout: 'codex' });

  it('cellFromImage：codex 标准 / 2× 按图求格；custom 用声明格', () => {
    expect(cellFromImage(codex, 1536, 1872)).toEqual({ width: 192, height: 208 });
    expect(cellFromImage(codex, 3072, 3744)).toEqual({ width: 384, height: 416 });
    const custom = resolveSprite({
      cell: { width: 32, height: 48 },
      states: { stand: { row: 0, frames: 2, durationsMs: 100 } },
      slots: { idle: 'stand' },
    });
    expect(cellFromImage(custom, 999, 999)).toEqual({ width: 32, height: 48 });
  });

  it('thumbScale：contain', () => {
    expect(thumbScale({ width: 192, height: 208 }, 200, 200)).toBeCloseTo(200 / 208, 6);
    expect(thumbScale({ width: 0, height: 0 }, 200, 200)).toBe(1);
  });

  it('frameBackground：按行列偏移并整体缩放', () => {
    const bg = frameBackground({ row: 8, col: 0 }, 3, { width: 192, height: 208 }, 0.5, {
      width: 1536,
      height: 1872,
    });
    expect(bg).toEqual({ backgroundPosition: '-288px -832px', backgroundSize: '768px 936px' });
    expect(frameBackground({ row: 0, col: 2 }, 0, { width: 10, height: 10 }, 1, { width: 80, height: 90 }).backgroundPosition).toBe(
      '-20px 0px',
    );
  });

  it('试播：情绪 enter 优先于 loop；未映射 null；动作走映射行', () => {
    expect(emotionPreviewState(codex, 'happy')).toBe('jumping');
    expect(emotionPreviewState(codex, 'sad')).toBe('failed');
    expect(emotionPreviewState(codex, 'angry')).toBeNull();
    expect(actionPreviewState(codex, 'wave')).toBe('waving');
    expect(actionPreviewState(codex, 'nod')).toBeNull();
  });

  it('tryResolveSprite：缺省 / 非法 → null', () => {
    expect(tryResolveSprite(undefined)).toBeNull();
    expect(tryResolveSprite({})).toBeNull();
    expect(tryResolveSprite({ layout: 'codex' })?.layout).toBe('codex');
  });
});

describe('总览 / 卡片 / 形象卡', () => {
  it('showcaseMode：sprite 走 CSS 帧预览，失败回退 preview / 首字', () => {
    expect(showcaseMode('sprite', false, false)).toBe('sprite');
    expect(showcaseMode('sprite', true, true)).toBe('preview');
    expect(showcaseMode('sprite', false, true)).toBe('initial');
    expect(showcaseMode('vrm', true, false)).toBe('live'); // 回归
  });

  it('toCardVm：sprite 数据源 + 映射行计数 + sprite.emotions 算情绪覆盖', () => {
    const c = toCardVm({ characterId: 'pixel-cat', manifest: SPRITE, builtin: false, active: false });
    expect(c.sprite).toEqual({ url: 'asset://pixel-cat/sheet.webp', sheet: SPRITE.sprite });
    expect(c.emotionCount).toBe(7);
    expect(c.actionCount).toBe(4);
    expect(c.hasEmotionOverride).toBe(false);
    const over = { ...SPRITE, sprite: { layout: 'codex' as const, emotions: { sad: null } } };
    expect(toCardVm({ characterId: 'x', manifest: over, builtin: false, active: false }).hasEmotionOverride).toBe(true);
    const vrm = toCardVm({
      characterId: 'v',
      manifest: { id: 'v', name: 'v', version: '1', engine: 'vrm', model: 'm.vrm' },
      builtin: true,
      active: false,
    });
    expect(vrm.sprite).toBeNull();
  });

  it('toBodyCard：形象库根的 sprite 数据源', () => {
    const b = BodyPackSchema.parse({ id: 'cat', name: '猫', version: '1', engine: 'sprite', model: 'a.png', sprite: { layout: 'codex' } });
    expect(toBodyCard({ body: b, sizeBytes: 1, installedAt: 1 }).sprite).toEqual({
      url: 'asset://cat/a.png',
      sheet: { layout: 'codex' },
    });
  });

  it('withoutEmotionOverrides：删三种情绪表，图集其余描述保留', () => {
    const m = { ...SPRITE, emotions: { a: { happy: 1 } }, sprite: { layout: 'codex' as const, smoothing: 'pixel' as const, emotions: { sad: null } } };
    const r = withoutEmotionOverrides(m);
    expect(r.emotions).toBeUndefined();
    expect(r.sprite).toEqual({ layout: 'codex', smoothing: 'pixel' });
    expect(CharacterManifestSchema.safeParse(r).success).toBe(true);
  });
});

describe('E4 帧动画映射编辑', () => {
  const sheet = (): SpriteSheet => ({ layout: 'codex' });

  it('情绪：与预设相同删键；清空有预设写 null；新映射写原文；speed 1 视为缺省', () => {
    const s = sheet();
    setSpriteEmotion(s, 'sad', { loop: 'failed' });
    expect(s.emotions).toEqual({});
    setSpriteEmotion(s, 'sad', null);
    expect(s.emotions).toEqual({ sad: null });
    setSpriteEmotion(s, 'angry', { enter: 'failed', speed: 1 });
    expect(s.emotions?.['angry']).toEqual({ enter: 'failed' });
    setSpriteEmotion(s, 'angry', { loop: '', enter: '' }); // 无预设清空 → 删键
    expect('angry' in (s.emotions ?? {})).toBe(false);
    setSpriteEmotion(s, 'sleepy', { loop: 'idle', speed: 0.6 }); // = 预设
    expect('sleepy' in (s.emotions ?? {})).toBe(false);
    setSpriteEmotion(s, 'sleepy', { loop: 'idle', speed: 0.5 });
    expect(s.emotions?.['sleepy']).toEqual({ loop: 'idle', speed: 0.5 });
  });

  it('动作：空 = 程序化（有预设写 null）；与预设相同删键', () => {
    const s = sheet();
    setSpriteAction(s, 'wave', null);
    setSpriteAction(s, 'nod', 'waiting');
    setSpriteAction(s, 'jump', 'jumping');
    expect(s.actions).toEqual({ wave: null, nod: 'waiting' });
    setSpriteAction(s, 'nod', null);
    expect(s.actions).toEqual({ wave: null });
  });

  it('槽位：空 / 与预设相同 → 继承', () => {
    const s = sheet();
    setSpriteSlot(s, 'talk', 'waiting');
    setSpriteSlot(s, 'idle', 'idle');
    expect(s.slots).toEqual({ talk: 'waiting' });
    setSpriteSlot(s, 'talk', null);
    expect(s.slots).toEqual({});
  });

  it('normalizeSprite：空表剥离，null 保留，不改原对象', () => {
    const raw: SpriteSheet = { layout: 'codex', emotions: {}, actions: { wave: null }, slots: {} };
    expect(normalizeSprite(raw)).toEqual({ layout: 'codex', actions: { wave: null } });
    expect(raw.emotions).toEqual({});
  });

  it('草稿往返：normalizeDraft 保留 sprite；无改动不脏；改映射变脏且过 schema', () => {
    const draft = JSON.parse(JSON.stringify(SPRITE)) as CharacterManifest;
    expect(normalizeDraft(draft).sprite).toEqual({ layout: 'codex', smoothing: 'pixel' });
    expect(isDirty(SPRITE, draft)).toBe(false);
    setSpriteEmotion(draft.sprite!, 'sad', null);
    expect(isDirty(SPRITE, draft)).toBe(true);
    expect(CharacterManifestSchema.safeParse(normalizeDraft(draft)).success).toBe(true);
    setSpriteEmotion(draft.sprite!, 'sad', { loop: 'failed' }); // 改回预设
    expect(isDirty(SPRITE, draft)).toBe(false);
  });

  it('validateDraft：映射指向不存在的状态 → spriteInvalid', () => {
    const d = JSON.parse(JSON.stringify(SPRITE)) as CharacterManifest;
    expect(validateDraft(d)['sprite']).toBeUndefined();
    d.sprite = { layout: 'codex', actions: { nod: 'dance' } };
    expect(validateDraft(d)['sprite']).toBe('settings.editor.errors.spriteInvalid');
  });

  it('编辑表行：默认词表 + 预设 + 作者原文', () => {
    const s: SpriteSheet = { layout: 'codex', emotions: { proud: { loop: 'jumping' } } };
    const emo = spriteEmotionNames(s);
    expect(emo).toContain('happy');
    expect(emo).toContain('thinking');
    expect(emo).toContain('proud');
    expect(spriteActionNames(s)).toEqual(expect.arrayContaining(['wave', 'nod', 'searching', 'droop']));
  });
});

describe('normalizeDraft 顺手修：actionClips / persona.styleAnchor 不再在 E4 保存时丢失', () => {
  it('原样保留', () => {
    const m: CharacterManifest = {
      id: 'v',
      name: 'v',
      version: '1',
      engine: 'vrm',
      model: 'm.vrm',
      actionClips: { wave: 'wave.vrma' },
      persona: { systemPrompt: '你是 v', beginDialogs: [], styleAnchor: '说话短一点' },
    };
    const out = normalizeDraft(JSON.parse(JSON.stringify(m)) as CharacterManifest);
    expect(out.actionClips).toEqual({ wave: 'wave.vrma' });
    expect(out.persona?.styleAnchor).toBe('说话短一点');
    expect(isDirty(m, JSON.parse(JSON.stringify(m)) as CharacterManifest)).toBe(false);
  });
});
