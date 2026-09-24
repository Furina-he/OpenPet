import { describe, it, expect } from 'vitest';
import { ZERO_OFFSETS, sampleAction, type BoneOffsets } from '../../src/renderer/character/actions';
import {
  FACING,
  FacingTracker,
  IDENTITY_2D,
  SPRITE_2D_GAIN,
  alphaBBox,
  compose2D,
  contentBoxInView,
  dragPendulum,
  fitSprite,
  offsetsTo2D,
  pixelRtSize,
  unionBBox,
} from '../../src/renderer/character/sprite-transform';
import { tapZone } from '../../src/renderer/character/interaction-zones';
import { bubbleTop } from '../../src/renderer/character/bubble-timer';

const H = 208;
const off = (o: Partial<BoneOffsets>): BoneOffsets => ({ ...ZERO_OFFSETS, ...o });

describe('offsetsTo2D（BoneOffsets → 2D）', () => {
  it('零偏移 = 恒等变换', () => {
    expect(offsetsTo2D(ZERO_OFFSETS, H)).toEqual({ ...IDENTITY_2D, dx: 0, dy: -0 });
  });

  it('jump 峰值 hipsY 0.06 → 上跳 12% 格高', () => {
    const t = offsetsTo2D(sampleAction('jump', 0.5), H);
    expect(t.dy).toBeCloseTo(-0.12 * H, 5);
  });

  it('nod headPitch 0.3 → 纵向压 6%，体积守恒横向 +3%', () => {
    const t = offsetsTo2D(off({ headPitch: 0.3 }), H);
    expect(t.sy).toBeCloseTo(0.94, 5);
    expect(t.sx).toBeCloseTo(1.03, 5);
  });

  it('tilt headRoll 0.3 → 约 8.6°', () => {
    const t = offsetsTo2D(off({ headRoll: 0.3 }), H);
    expect((t.rot * 180) / Math.PI).toBeCloseTo(8.59, 1);
  });

  it('shake headYaw → skewX 同号，幅度 ×0.25', () => {
    expect(offsetsTo2D(off({ headYaw: 0.38 }), H).skewX).toBeCloseTo(0.095, 5);
    expect(offsetsTo2D(off({ headYaw: -0.38 }), H).skewX).toBeCloseTo(-0.095, 5);
  });

  it('重心 hipsX → dx；挥手右臂 → rot 正、sy 微增', () => {
    expect(offsetsTo2D(off({ hipsX: 0.012 }), H).dx).toBeCloseTo(0.024 * H, 5);
    const w = offsetsTo2D(off({ armRaiseR: 1 }), H);
    expect(w.rot).toBeCloseTo(0.03, 5);
    expect(w.sy).toBeCloseTo(1.02, 5);
  });

  it('增益表可调（harness 写入即生效）', () => {
    const g = { ...SPRITE_2D_GAIN, hipsY: 1 };
    expect(offsetsTo2D(off({ hipsY: 0.06 }), H, g).dy).toBeCloseTo(-0.06 * H, 5);
  });

  it('compose2D：位移/角度相加，缩放相乘', () => {
    const a = { dx: 1, dy: 2, rot: 0.1, sx: 1.1, sy: 0.9, skewX: 0.01 };
    expect(compose2D(a, { dx: 1, sy: 1.1, rot: 0.1 })).toEqual({
      dx: 2,
      dy: 2,
      rot: 0.2,
      sx: 1.1,
      sy: 0.9 * 1.1,
      skewX: 0.01,
    });
  });

  it('dragPendulum：右移为正、左移为负，夹紧到 30°×0.6', () => {
    expect(dragPendulum(0.5)).toBeGreaterThan(0);
    expect(dragPendulum(-0.5)).toBeLessThan(0);
    expect((dragPendulum(100) * 180) / Math.PI).toBeCloseTo(18, 5);
    expect(dragPendulum(0)).toBe(0);
  });
});

describe('fitSprite', () => {
  it('contain：内缩 10% 后等比、底边对齐、水平居中', () => {
    const f = fitSprite(320, 480, 192, 208, 'contain');
    // innerW 256 / 192 = 1.333；innerH 432 / 208 = 2.077 → 取 1.333
    expect(f.scale).toBeCloseTo(256 / 192, 5);
    expect(f.y + f.h).toBeCloseTo(480, 5);
    expect(f.x).toBeCloseTo((320 - f.w) / 2, 5);
  });

  it('integer：不超过 contain 的最大整数倍', () => {
    const f = fitSprite(800, 900, 64, 64, 'integer'); // contain = 640/64 = 10
    expect(f.scale).toBe(10);
    expect(fitSprite(700, 900, 64, 64, 'integer').scale).toBe(8); // 560/64 = 8.75
  });

  it('integer：小窗 contain < 1 时退回 contain', () => {
    const f = fitSprite(100, 100, 192, 208, 'integer');
    expect(f.scale).toBeCloseTo(80 / 192, 5);
  });

  it('pixelRtSize：格宽 ×1.5、格高 ×1.35 向上取整', () => {
    expect(pixelRtSize({ width: 192, height: 208 })).toEqual({ w: 288, h: 281 });
  });
});

describe('FacingTracker（flipToCursor）', () => {
  it('素材朝右：光标在左侧越过迟滞带并持续 400ms → 120ms 过零翻转', () => {
    const f = new FacingTracker('right');
    expect(f.update(-100, 0)).toBe(1);
    expect(f.update(-100, FACING.debounceMs - 1)).toBe(1); // 去抖中
    expect(f.update(-100, FACING.debounceMs)).toBe(1); // 开始翻转
    expect(f.update(-100, FACING.debounceMs + 60)).toBeCloseTo(0, 5); // 过零
    expect(f.update(-100, FACING.debounceMs + 120)).toBe(-1);
    expect(f.isFlipped()).toBe(true);
  });

  it('迟滞带（±40px）内保持当前朝向', () => {
    const f = new FacingTracker('right');
    f.update(-100, 0);
    f.update(-100, 500);
    f.update(-100, 700);
    expect(f.update(30, 1000)).toBe(-1);
    expect(f.update(30, 2000)).toBe(-1);
  });

  it('去抖：短暂越界又回来不翻', () => {
    const f = new FacingTracker('right');
    f.update(-100, 0);
    f.update(100, 200);
    expect(f.update(-100, 500)).toBe(1);
    expect(f.isFlipped()).toBe(false);
  });

  it('素材朝左：光标在右侧才翻', () => {
    const f = new FacingTracker('left');
    f.update(-100, 0);
    expect(f.update(-100, 1000)).toBe(1);
    f.update(100, 1100);
    f.update(100, 1100 + FACING.debounceMs); // 去抖满 → 开始翻转
    expect(f.update(100, 1100 + FACING.debounceMs + FACING.flipMs)).toBe(-1);
  });
});

describe('alphaBBox / unionBBox / contentBoxInView', () => {
  function rgba(w: number, h: number, opaque: Array<[number, number]>): Uint8ClampedArray {
    const a = new Uint8ClampedArray(w * h * 4);
    for (const [x, y] of opaque) a[(y * w + x) * 4 + 3] = 255;
    return a;
  }

  it('合成像素的不透明包围盒', () => {
    expect(alphaBBox(rgba(8, 8, [[2, 3], [5, 6], [4, 4]]), 8, 8)).toEqual({ x: 2, y: 3, w: 4, h: 4 });
  });

  it('全透明 → null；低于阈值的淡影不计', () => {
    expect(alphaBBox(rgba(4, 4, []), 4, 4)).toBeNull();
    const faint = new Uint8ClampedArray(16 * 4);
    faint[3] = 10;
    expect(alphaBBox(faint, 4, 4)).toBeNull();
  });

  it('unionBBox 取并集，跳过 null', () => {
    expect(unionBBox([{ x: 2, y: 2, w: 2, h: 2 }, null, { x: 0, y: 3, w: 1, h: 4 }])).toEqual({
      x: 0,
      y: 2,
      w: 4,
      h: 5,
    });
    expect(unionBBox([null])).toBeNull();
  });

  it('contentBoxInView：格内包围盒按 fit 映射到窗口坐标', () => {
    const fit = { scale: 2, x: 10, y: 100, w: 384, h: 416 };
    expect(contentBoxInView({ x: 0, y: 40, w: 10, h: 150 }, fit)).toEqual({ top: 180, bottom: 480 });
  });
});

describe('tapZone（⑳ 可选轮廓）/ bubbleTop', () => {
  it('无 box：与本批前一致（按窗口高 38%）', () => {
    expect(tapZone(170, 480)).toBe('head');
    expect(tapZone(200, 480)).toBe('body');
    expect(tapZone(170, 480, null)).toBe('head');
  });

  it('有 box：按轮廓内 38% 分头身', () => {
    const box = { top: 200, bottom: 480 }; // 高 280，头部线 = 200 + 106.4
    expect(tapZone(300, 480, box)).toBe('head');
    expect(tapZone(310, 480, box)).toBe('body');
    expect(tapZone(170, 480, box)).toBe('head'); // 轮廓上方的空白按头算
  });

  it('bubbleTop：贴轮廓顶上方 8px，下限 12', () => {
    expect(bubbleTop(200, 80)).toBe(112);
    expect(bubbleTop(60, 80)).toBe(12);
  });
});
