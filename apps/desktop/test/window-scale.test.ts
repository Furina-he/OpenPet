import { describe, it, expect } from 'vitest';
import {
  CHARACTER_BASE_SIZE,
  CODEX_NOMINAL_CELL,
  DEFAULT_MARGIN,
  HUB_IDEAL_SIZE,
  HUB_MIN_SIZE,
  MIN_CANVAS,
  SCALE_PRESETS,
  SPRITE_BASE_INSET,
  anchorFromBounds,
  baseSizeFor,
  boundsFromAnchor,
  clampAnchor,
  defaultAnchor,
  fromRelative,
  hubWindowSize,
  isPixelSnap,
  maxFitScale,
  modelSize,
  pickPlacement,
  resolutionKey,
  scalePresets,
  snapScale,
  stageLayout,
  toRelative,
  type Bounds,
  type DisplayInfo,
} from '../electron/main/window-scale';
import { SPRITE_FIT_INSET } from '../src/renderer/character/sprite-transform';
import type { CharacterManifest } from '@openpet/protocol';

/** ㉓ 前的 D4 缩放几何（底边中点锚定、窗口 = 底座 × s）——零回归断言的参照实现。 */
function legacyScaledBounds(current: Bounds, scale: number): Bounds {
  const width = Math.round(320 * scale);
  const height = Math.round(480 * scale);
  const centerX = current.x + current.width / 2;
  const bottom = current.y + current.height;
  return { x: Math.round(centerX - width / 2), y: Math.round(bottom - height), width, height };
}

const WA: Bounds = { x: 0, y: 0, width: 1920, height: 1040 };
/** 现状默认站位（windows.ts：主屏工作区右下、距边 24，窗口 = 320×480）。 */
const DEFAULT_WINDOW: Bounds = {
  x: WA.x + WA.width - 320 - 24,
  y: WA.y + WA.height - 480 - 24,
  width: 320,
  height: 480,
};

const vrm = { engine: 'vrm' } as Pick<CharacterManifest, 'engine' | 'sprite'>;
const live2d = { engine: 'live2d' } as Pick<CharacterManifest, 'engine' | 'sprite'>;
const codex = {
  engine: 'sprite',
  sprite: { layout: 'codex' },
} as Pick<CharacterManifest, 'engine' | 'sprite'>;

describe('legacyScaledBounds（㉓ 前的参照实现，自检）', () => {
  const cur = { x: 100, y: 200, width: 320, height: 480 }; // scale=1 站位

  it('base size matches the character window default', () => {
    expect(CHARACTER_BASE_SIZE).toEqual({ width: 320, height: 480 });
  });

  it('keeps bottom-center anchored at 50% / 200%', () => {
    expect(legacyScaledBounds(cur, 0.5)).toEqual({ x: 180, y: 440, width: 160, height: 240 });
    expect(legacyScaledBounds(cur, 2)).toEqual({ x: -60, y: -280, width: 640, height: 960 });
  });
});

describe('hubWindowSize', () => {
  it('uses the ideal dashboard size on a large display', () => {
    expect(hubWindowSize({ width: 1920, height: 1040 })).toEqual({ width: 1280, height: 832 });
    expect(HUB_IDEAL_SIZE).toEqual({ width: 1280, height: 832 });
  });

  it('clamps into the work area with margin on a small laptop display', () => {
    // 1366×768 工作区：宽 1318 可容理想 1280；高 clamp 到 768-48=720
    expect(hubWindowSize({ width: 1366, height: 768 })).toEqual({ width: 1280, height: 720 });
  });

  it('never goes below the minimum usable size', () => {
    expect(hubWindowSize({ width: 800, height: 600 })).toEqual(HUB_MIN_SIZE);
    expect(HUB_MIN_SIZE).toEqual({ width: 960, height: 640 });
  });
});

describe('㉓ 底座（baseSizeFor）', () => {
  it('VRM / Live2D = 320×480（不变）', () => {
    expect(baseSizeFor(vrm)).toEqual({ width: 320, height: 480 });
    expect(baseSizeFor(live2d)).toEqual({ width: 320, height: 480 });
  });

  it('codex 精灵：名义格 192×208 ÷ 适配内缩 = 240×231（100% = 原生 1×）', () => {
    expect(CODEX_NOMINAL_CELL).toEqual({ width: 192, height: 208 });
    expect(baseSizeFor(codex)).toEqual({ width: 240, height: 231 });
  });

  it('codex 2× 高清图集（显式 cell 384×416）视觉大小不变：仍按名义格', () => {
    const hd = {
      engine: 'sprite',
      sprite: { layout: 'codex', cell: { width: 384, height: 416 } },
    } as Pick<CharacterManifest, 'engine' | 'sprite'>;
    expect(baseSizeFor(hd)).toEqual({ width: 240, height: 231 });
  });

  it('custom 布局取 sprite.cell', () => {
    const custom = {
      engine: 'sprite',
      sprite: { cell: { width: 64, height: 64 } },
    } as Pick<CharacterManifest, 'engine' | 'sprite'>;
    expect(baseSizeFor(custom)).toEqual({ width: 80, height: 71 });
  });

  it('内缩常量与 renderer 的 SPRITE_FIT_INSET 同值（Main 不 import renderer，各自定义）', () => {
    expect(SPRITE_BASE_INSET).toEqual(SPRITE_FIT_INSET);
  });

  it('像素吸附只认 fit: integer（只设 smoothing: pixel 的照常自由缩放）', () => {
    const integer = {
      engine: 'sprite',
      sprite: { layout: 'codex', fit: 'integer' },
    } as Pick<CharacterManifest, 'engine' | 'sprite'>;
    const pixelOnly = {
      engine: 'sprite',
      sprite: { layout: 'codex', smoothing: 'pixel' },
    } as Pick<CharacterManifest, 'engine' | 'sprite'>;
    expect(isPixelSnap(integer)).toBe(true);
    expect(isPixelSnap(pixelOnly)).toBe(false);
    expect(isPixelSnap(codex)).toBe(false);
    expect(isPixelSnap(vrm)).toBe(false);
  });
});

describe('㉓ 模型框 + 舞台边（stageLayout）', () => {
  it('modelSize 取整', () => {
    expect(modelSize({ width: 320, height: 480 }, 0.77)).toEqual({ width: 246, height: 370 });
  });

  it('100% VRM：模型框 ≥ 最小画布 → 窗口 = 模型框（现状）', () => {
    expect(MIN_CANVAS).toEqual({ width: 300, height: 360 });
    expect(stageLayout({ width: 320, height: 480 })).toEqual({
      window: { width: 320, height: 480 },
      model: { x: 0, y: 0, width: 320, height: 480 },
    });
  });

  it('50% VRM：窗口 300×360，模型框底边居中，头顶留 120px 舞台边给气泡', () => {
    expect(stageLayout(modelSize(CHARACTER_BASE_SIZE, 0.5))).toEqual({
      window: { width: 300, height: 360 },
      model: { x: 70, y: 120, width: 160, height: 240 },
    });
  });

  it('100% codex 精灵：模型框 240×231、窗口 300×360', () => {
    expect(stageLayout(baseSizeFor(codex))).toEqual({
      window: { width: 300, height: 360 },
      model: { x: 30, y: 129, width: 240, height: 231 },
    });
  });

  it('只有一个方向小于最小画布时只补那个方向', () => {
    expect(stageLayout({ width: 240, height: 400 })).toEqual({
      window: { width: 300, height: 400 },
      model: { x: 30, y: 0, width: 240, height: 400 },
    });
  });
});

describe('㉓ 锚点（脚底 = 模型框底边中点）', () => {
  it('boundsFromAnchor / anchorFromBounds 互逆', () => {
    const layout = stageLayout(modelSize(CHARACTER_BASE_SIZE, 0.5));
    const b = boundsFromAnchor({ x: 1000, y: 900 }, layout);
    expect(b).toEqual({ x: 850, y: 540, width: 300, height: 360 });
    expect(anchorFromBounds(b, layout)).toEqual({ x: 1000, y: 900 });
  });

  it('零回归：100% VRM / Live2D 在默认位 = 旧 scaledBounds(当前, 1)', () => {
    for (const m of [vrm, live2d]) {
      const layout = stageLayout(modelSize(baseSizeFor(m), 1));
      const anchor = anchorFromBounds(DEFAULT_WINDOW, layout);
      expect(boundsFromAnchor(anchor, layout)).toEqual(legacyScaledBounds(DEFAULT_WINDOW, 1));
      expect(boundsFromAnchor(anchor, layout)).toEqual(DEFAULT_WINDOW);
    }
  });

  it('模型框 ≥ 最小画布的档位与旧几何逐像素一致（缩放以脚底为锚）', () => {
    const anchor = anchorFromBounds(DEFAULT_WINDOW, stageLayout(CHARACTER_BASE_SIZE));
    for (const s of [0.95, 1, 1.05, 1.25, 1.5, 1.75, 2]) {
      const layout = stageLayout(modelSize(CHARACTER_BASE_SIZE, s));
      expect(boundsFromAnchor(anchor, layout)).toEqual(legacyScaledBounds(DEFAULT_WINDOW, s));
    }
  });

  it('默认锚点 = 主屏工作区右下、距边 24（100% VRM 时与 windows.ts 初始位一致）', () => {
    expect(DEFAULT_MARGIN).toBe(24);
    const layout = stageLayout(CHARACTER_BASE_SIZE);
    expect(boundsFromAnchor(defaultAnchor(CHARACTER_BASE_SIZE, WA), layout)).toEqual(
      DEFAULT_WINDOW,
    );
  });
});

describe('㉓ 夹屏（clampAnchor）/ maxFit', () => {
  const modelBox = (a: { x: number; y: number }, m: { width: number; height: number }) => ({
    x: a.x - m.width / 2,
    y: a.y - m.height,
    width: m.width,
    height: m.height,
  });
  const inside = (b: Bounds, wa: Bounds): boolean =>
    b.x >= wa.x && b.y >= wa.y && b.x + b.width <= wa.x + wa.width && b.y + b.height <= wa.y + wa.height;

  it('默认位放大到 200%：右侧不再出屏，模型框完整落在工作区内', () => {
    const anchor = defaultAnchor(CHARACTER_BASE_SIZE, WA);
    const big = modelSize(CHARACTER_BASE_SIZE, 2);
    expect(inside(modelBox(anchor, big), WA)).toBe(false); // 不夹：右出 136px
    const clamped = clampAnchor(anchor, big, WA);
    expect(inside(modelBox(clamped, big), WA)).toBe(true);
    expect(clamped).toEqual({ x: 1600, y: 1016 }); // 只水平平移，脚底高度不变
  });

  it('靠屏顶放大：头顶不出屏（竖直平移）', () => {
    const big = modelSize(CHARACTER_BASE_SIZE, 1.5);
    const clamped = clampAnchor({ x: 960, y: 500 }, big, WA);
    expect(clamped).toEqual({ x: 960, y: 720 });
  });

  it('屏内不动；非零原点的副屏同样夹', () => {
    const m = modelSize(CHARACTER_BASE_SIZE, 1);
    expect(clampAnchor({ x: 960, y: 900 }, m, WA)).toEqual({ x: 960, y: 900 });
    const side: Bounds = { x: -1280, y: 200, width: 1280, height: 984 };
    expect(clampAnchor({ x: -1270, y: 300 }, m, side)).toEqual({ x: -1120, y: 680 });
  });

  it('模型框比工作区还大（仅极小屏）：水平居中、脚底贴工作区底', () => {
    const tiny: Bounds = { x: 0, y: 0, width: 200, height: 300 };
    expect(clampAnchor({ x: 50, y: 50 }, { width: 320, height: 480 }, tiny)).toEqual({
      x: 100,
      y: 300,
    });
  });

  it('maxFitScale = min(2, 工作区宽 / 底宽, 工作区高 / 底高)，不低于 0.5', () => {
    expect(maxFitScale(CHARACTER_BASE_SIZE, WA)).toBe(2);
    expect(maxFitScale(CHARACTER_BASE_SIZE, { width: 1366, height: 728 })).toBeCloseTo(728 / 480, 9);
    expect(maxFitScale(CHARACTER_BASE_SIZE, { width: 400, height: 200 })).toBe(0.5);
  });
});

describe('㉓ 吸附（snapScale / scalePresets）', () => {
  const normal = { pixelArt: false, dpr: 1, maxFit: 2 };

  it('常规：5% 网格（无浮点毛刺）并夹 [0.5, maxFit]', () => {
    expect(snapScale(1.13, normal)).toBe(1.15);
    expect(snapScale(1.12, normal)).toBe(1.1);
    expect(snapScale(0.47, normal)).toBe(0.5);
    expect(snapScale(3, normal)).toBe(2);
    expect(snapScale(1.6, { ...normal, maxFit: 728 / 480 })).toBeCloseTo(728 / 480, 9);
  });

  it('常规档位表 = 50/75/100/125/150/200%（与 dpr 无关）', () => {
    expect(SCALE_PRESETS).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
    expect(scalePresets({ pixelArt: false, dpr: 1.5 })).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
  });

  it('像素档位 = 设备像素整数倍 k / dpr 落在 [0.5, 2] 内', () => {
    const p = (dpr: number) => scalePresets({ pixelArt: true, dpr });
    expect(p(1)).toEqual([1, 2]);
    expect(p(1.25)).toEqual([0.8, 1.6]);
    expect(p(1.5)).toEqual([0.6667, 1.3333, 2]);
    expect(p(2)).toEqual([0.5, 1, 1.5, 2]);
  });

  it('像素吸附：取 [0.5, maxFit] 内最近的清晰档', () => {
    const px = (dpr: number, maxFit = 2) => ({ pixelArt: true, dpr, maxFit });
    expect(snapScale(1.4, px(1))).toBe(1);
    expect(snapScale(1.6, px(1))).toBe(2);
    expect(snapScale(1, px(1.25))).toBe(0.8);
    expect(snapScale(1.25, px(1.25))).toBe(1.6);
    expect(snapScale(1.3, px(1.5))).toBe(1.3333);
    expect(snapScale(1.9, px(1, 1.5))).toBe(1); // 2× 超出 maxFit
    expect(snapScale(1, px(1.5))).toBe(1.3333); // 0.667 与 1.333 等距：取大
  });

  it('像素吸附：区间内无档（仅极小工作区）→ 最小清晰档（dpr ≤ 2 即 1 / dpr）', () => {
    expect(snapScale(0.5, { pixelArt: true, dpr: 1.5, maxFit: 0.55 })).toBe(0.6667);
    expect(snapScale(0.7, { pixelArt: true, dpr: 1, maxFit: 0.9 })).toBe(1);
    expect(snapScale(0.5, { pixelArt: true, dpr: 3, maxFit: 0.55 })).toBe(0.6667); // 1/3 < 0.5 不取
  });

  it('幂等：吸附结果再吸一次不变（含不在网格上的 maxFit）', () => {
    const cases: Array<{ pixelArt: boolean; dpr: number; maxFit: number }> = [
      { pixelArt: false, dpr: 1, maxFit: 2 },
      { pixelArt: false, dpr: 1, maxFit: 728 / 480 },
      { pixelArt: false, dpr: 1.5, maxFit: 0.52 },
      { pixelArt: true, dpr: 1, maxFit: 2 },
      { pixelArt: true, dpr: 1.25, maxFit: 1.7 },
      { pixelArt: true, dpr: 1.5, maxFit: 0.55 },
      { pixelArt: true, dpr: 1.75, maxFit: 2 },
    ];
    for (const o of cases) {
      for (let s = 0.3; s <= 2.4; s += 0.037) {
        const once = snapScale(s, o);
        expect(snapScale(once, o), `${JSON.stringify(o)} s=${s}`).toBe(once);
      }
    }
  });
});

describe('㉓ 位置记录（相对比例 + 两级键）', () => {
  const primary: DisplayInfo = { id: '1', workArea: WA, scaleFactor: 1.25 };
  const side: DisplayInfo = {
    id: '2',
    workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
    scaleFactor: 1.5,
  };
  const empty = { lastDisplayId: '', byDisplay: {}, byResolution: {} };

  it('toRelative / fromRelative 互逆；工作区外夹进 0–1；零尺寸不出 NaN', () => {
    const rel = toRelative({ x: 1736, y: 1016 }, WA);
    expect(rel.rx).toBeCloseTo(1736 / 1920, 4);
    expect(rel.ry).toBeCloseTo(1016 / 1040, 4);
    const back = fromRelative(rel, WA);
    expect(back.x).toBeCloseTo(1736, 1);
    expect(back.y).toBeCloseTo(1016, 1);
    expect(toRelative({ x: -50, y: 2000 }, WA)).toEqual({ rx: 0, ry: 1 });
    expect(toRelative({ x: 5, y: 5 }, { x: 0, y: 0, width: 0, height: 0 })).toEqual({
      rx: 0.5,
      ry: 0.5,
    });
  });

  it('按比例重算：DPI / 分辨率变化后仍在相对同一位置', () => {
    const rel = toRelative({ x: 1736, y: 1016 }, WA);
    const moved = fromRelative(rel, { x: 0, y: 0, width: 1536, height: 824 });
    expect(moved.x).toBeCloseTo(1536 * (1736 / 1920), 1);
  });

  it('resolutionKey = 工作区「宽x高」', () => {
    expect(resolutionKey(WA)).toBe('1920x1040');
  });

  it('pickPlacement：上次所在屏按 id 命中', () => {
    const saved = {
      lastDisplayId: '2',
      byDisplay: { '1': { rx: 0.9, ry: 0.98 }, '2': { rx: 0.2, ry: 0.5 } },
      byResolution: {},
    };
    expect(pickPlacement(saved, [primary, side], primary)).toEqual({
      display: side,
      rel: { rx: 0.2, ry: 0.5 },
    });
  });

  it('pickPlacement：id 变了（驱动更新 / 重插）按分辨率找回', () => {
    const saved = {
      lastDisplayId: 'old',
      byDisplay: { old: { rx: 0.3, ry: 0.4 } },
      byResolution: { '1920x1040': { rx: 0.3, ry: 0.4 } },
    };
    expect(pickPlacement(saved, [primary], primary)).toEqual({
      display: primary,
      rel: { rx: 0.3, ry: 0.4 },
    });
  });

  it('pickPlacement：上次所在屏只有分辨率记录也能恢复', () => {
    const saved = {
      lastDisplayId: '2',
      byDisplay: {},
      byResolution: { '2560x1400': { rx: 0.6, ry: 0.7 } },
    };
    expect(pickPlacement(saved, [primary, side], primary).rel).toEqual({ rx: 0.6, ry: 0.7 });
  });

  it('pickPlacement：所在屏已拔 → 主屏两级查', () => {
    const saved = {
      lastDisplayId: '2',
      byDisplay: { '1': { rx: 0.9, ry: 0.98 }, '2': { rx: 0.2, ry: 0.5 } },
      byResolution: {},
    };
    expect(pickPlacement(saved, [primary], primary)).toEqual({
      display: primary,
      rel: { rx: 0.9, ry: 0.98 },
    });
  });

  it('pickPlacement：全无记录 → 主屏 + rel null（默认位）', () => {
    expect(pickPlacement(empty, [primary, side], primary)).toEqual({ display: primary, rel: null });
  });
});
