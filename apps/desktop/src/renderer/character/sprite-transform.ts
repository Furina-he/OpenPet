/**
 * ⑳ 程序化通道 → 2D（spec §2.3 / §3）——复用 ⑱ 全部纯逻辑（LifeLayer / PostureLayer / 动作包络 / 拖拽），
 * 只新增一个映射 `offsetsTo2D(BoneOffsets) → {dx, dy, rot, sx, sy, skewX}`；外加窗口适配、pixel 模式
 * 原生分辨率 RT 尺寸、朝向翻转、alpha 包围盒与轮廓映射。全部纯函数 / 纯状态机，sprite-runtime 只装配。
 */
import type { BoneOffsets } from './actions';
import { dragToParams } from './live2d-map';

/** 增益表（首版值；harness 可调，真窗定稿后回写常量）。 */
export const SPRITE_2D_GAIN = {
  /** dy = −hipsY × k × 格高（跳跃 / 呼吸）。 */
  hipsY: 2.0,
  /** dx = hipsX × k × 格高（重心）。 */
  hipsX: 2.0,
  /** sy = 1 − (chest×a + spine×b + head×c)。 */
  chestPitch: 0.5,
  spinePitch: 0.35,
  headPitch: 0.2,
  /** sx = 1 + (1 − sy) × k（体积守恒）。 */
  volume: 0.5,
  /** rot = headRoll×a + spineRoll×b + spineYaw×c。 */
  headRoll: 0.5,
  spineRoll: 1,
  spineYaw: 0.2,
  /** skewX = headYaw × k。 */
  headYaw: 0.25,
  /** 手臂：sy += (L+R)×k；rot += (R−L)×k2。 */
  armsSy: 0.02,
  armsRot: 0.03,
  /** 拖拽摆动 = dragToParams 角度 × k（外层顶部枢轴）。 */
  drag: 0.6,
  /** 无 talk 行时嘴型起伏 sy += v × k。 */
  mouth: 0.012,
};

export interface Transform2D {
  /** 位移（源像素 = 格像素；smooth 模式由 runtime 再乘 fit.scale）。 */
  dx: number;
  dy: number;
  /** 旋转（rad，屏幕坐标系顺时针为正）。 */
  rot: number;
  sx: number;
  sy: number;
  skewX: number;
}

export const IDENTITY_2D: Transform2D = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, skewX: 0 };

/** BoneOffsets → 2D 变换（内层，底部中心枢轴）。 */
export function offsetsTo2D(o: BoneOffsets, cellH: number, g = SPRITE_2D_GAIN): Transform2D {
  let sy = 1 - (o.chestPitch * g.chestPitch + o.spinePitch * g.spinePitch + o.headPitch * g.headPitch);
  sy += (o.armRaiseL + o.armRaiseR) * g.armsSy;
  const sx = 1 + (1 - sy) * g.volume;
  return {
    dx: o.hipsX * g.hipsX * cellH,
    dy: -o.hipsY * g.hipsY * cellH,
    rot:
      o.headRoll * g.headRoll +
      o.spineRoll * g.spineRoll +
      o.spineYaw * g.spineYaw +
      (o.armRaiseR - o.armRaiseL) * g.armsRot,
    sx,
    sy,
    skewX: o.headYaw * g.headYaw,
  };
}

/** 叠加：位移 / 角度相加，缩放相乘。 */
export function compose2D(a: Transform2D, b: Partial<Transform2D>): Transform2D {
  return {
    dx: a.dx + (b.dx ?? 0),
    dy: a.dy + (b.dy ?? 0),
    rot: a.rot + (b.rot ?? 0),
    sx: a.sx * (b.sx ?? 1),
    sy: a.sy * (b.sy ?? 1),
    skewX: a.skewX + (b.skewX ?? 0),
  };
}

/** 拖拽速度 → 外层顶部枢轴摆角（rad）：与 Live2D 同源 dragToParams 角度 × 增益。 */
export function dragPendulum(vx: number, g = SPRITE_2D_GAIN): number {
  return (dragToParams(vx, 0).angleZ * g.drag * Math.PI) / 180;
}

// ---- 适配窗口（spec §3.3）----

/** contain 内缩区：左右各 10%、顶 10%（给摆动与跳跃留边）；底边对齐、水平居中。 */
export const SPRITE_FIT_INSET = { side: 0.1, top: 0.1 };

export interface SpriteFit {
  scale: number;
  /** 格在窗口内的左上角与尺寸（CSS px）。 */
  x: number;
  y: number;
  w: number;
  h: number;
}

export function fitSprite(
  viewW: number,
  viewH: number,
  cellW: number,
  cellH: number,
  mode: 'contain' | 'integer',
): SpriteFit {
  const innerW = viewW * (1 - 2 * SPRITE_FIT_INSET.side);
  const innerH = viewH * (1 - SPRITE_FIT_INSET.top);
  const contain = cellW > 0 && cellH > 0 ? Math.min(innerW / cellW, innerH / cellH) : 1;
  const scale = mode === 'integer' && contain >= 1 ? Math.floor(contain) : contain;
  const w = cellW * scale;
  const h = cellH * scale;
  return { scale, x: (viewW - w) / 2, y: viewH - h, w, h };
}

/** pixel 模式原生分辨率 RenderTexture：格宽 ×1.5、格高 ×1.35（给跳跃与摆动留边）。 */
export const PIXEL_RT_PAD = { w: 1.5, h: 1.35 };
export function pixelRtSize(cell: { width: number; height: number }): { w: number; h: number } {
  return { w: Math.ceil(cell.width * PIXEL_RT_PAD.w), h: Math.ceil(cell.height * PIXEL_RT_PAD.h) };
}

// ---- 朝向翻转（spec §1.1 flipToCursor）----

export const FACING = { hysteresisPx: 40, debounceMs: 400, flipMs: 120 };

/**
 * 素材朝向 left / right：鼠标在「背后」一侧（越过 ±40px 迟滞带）且持续 400ms → 120ms 过零缩放翻转。
 * `update` 返回水平缩放系数（−1..1，翻转过程中过零）。
 */
export class FacingTracker {
  private flipped = false;
  private pending: { flipped: boolean; since: number } | null = null;
  private animFrom = 1;
  private animTo = 1;
  private animStart = -Infinity;

  constructor(private readonly facing: 'left' | 'right') {}

  /** dx = 光标 x − 角色中心 x（px）。 */
  update(dx: number, now: number): number {
    // 素材朝右：光标在左侧（dx < −40）才需要翻；朝左反之
    const behind = this.facing === 'right' ? dx < -FACING.hysteresisPx : dx > FACING.hysteresisPx;
    const front = this.facing === 'right' ? dx > FACING.hysteresisPx : dx < -FACING.hysteresisPx;
    const want = behind ? true : front ? false : this.flipped; // 迟滞带内保持
    if (want !== this.flipped) {
      if (!this.pending || this.pending.flipped !== want) this.pending = { flipped: want, since: now };
      if (now - this.pending.since >= FACING.debounceMs) {
        this.animFrom = this.scaleAt(now);
        this.flipped = want;
        this.animTo = want ? -1 : 1;
        this.animStart = now;
        this.pending = null;
      }
    } else {
      this.pending = null;
    }
    return this.scaleAt(now);
  }

  isFlipped(): boolean {
    return this.flipped;
  }

  private scaleAt(now: number): number {
    const k = Math.min(1, Math.max(0, (now - this.animStart) / FACING.flipMs));
    return this.animFrom + (this.animTo - this.animFrom) * k;
  }
}

// ---- 可见轮廓（spec §3.4）----

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** alpha 命中进入阈值（与 interaction.ts 的 ENTER 同口径 ≈0.10）。 */
export const BBOX_ALPHA_MIN = 26;

/** RGBA 像素数组的不透明包围盒；全透明 → null。 */
export function alphaBBox(
  rgba: ArrayLike<number>,
  w: number,
  h: number,
  alphaMin = BBOX_ALPHA_MIN,
): BBox | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((rgba[(y * w + x) * 4 + 3] ?? 0) < alphaMin) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** 包围盒并集（null 跳过；全 null → null）。 */
export function unionBBox(list: ReadonlyArray<BBox | null>): BBox | null {
  let out: BBox | null = null;
  for (const b of list) {
    if (!b) continue;
    if (!out) {
      out = { ...b };
      continue;
    }
    const x2 = Math.max(out.x + out.w, b.x + b.w);
    const y2 = Math.max(out.y + out.h, b.y + b.h);
    out.x = Math.min(out.x, b.x);
    out.y = Math.min(out.y, b.y);
    out.w = x2 - out.x;
    out.h = y2 - out.y;
  }
  return out;
}

/** 格内包围盒 → 窗口坐标的上下沿（CSS px）。 */
export function contentBoxInView(bbox: BBox, fit: SpriteFit): { top: number; bottom: number } {
  return { top: fit.y + bbox.y * fit.scale, bottom: fit.y + (bbox.y + bbox.h) * fit.scale };
}
