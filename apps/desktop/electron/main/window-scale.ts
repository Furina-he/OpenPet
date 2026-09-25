/**
 * character 窗几何（纯函数，Electron 缝在 character-stage / ipc-router）。
 * ㉓ 模型框 + 舞台边：窗口 = max(模型框, 最小画布)，模型框底边居中；锚点 = 模型框底边中点（脚底）——
 * 桌宠"站"在桌面上，缩放 / 换形象时脚底不漂移。
 */
import type { CharacterManifest, CharacterPlacement, PlacementPoint } from '@openpet/protocol';

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Size {
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}

/** VRM / Live2D 底座（100% 模型框）。 */
export const CHARACTER_BASE_SIZE = { width: 320, height: 480 } as const;
/** 最小画布：小尺寸时气泡 / toast 的容身处（透明舞台边，alpha 0 → 穿透）。 */
export const MIN_CANVAS = { width: 300, height: 360 } as const;
export const SCALE_MIN = 0.5;
export const SCALE_MAX = 2;
export const SCALE_STEP = 0.05;
/** 菜单 / D4 的常规档位。 */
export const SCALE_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
/** 默认位：主屏工作区右下、距边 24（与 Codex 同值；windows.ts 初始位同口径）。 */
export const DEFAULT_MARGIN = 24;
/** Codex 名义格：2× 高清图集只是更锐，视觉大小不变。 */
export const CODEX_NOMINAL_CELL = { width: 192, height: 208 } as const;
/**
 * 精灵适配内缩（左右各 10%、顶 10%）。与 renderer `sprite-transform#SPRITE_FIT_INSET` 同值——
 * Main 不 import renderer，这里重复定义，测试锁两边相等。
 */
export const SPRITE_BASE_INSET = { side: 0.1, top: 0.1 } as const;

/** Hub（settings 窗）仪表盘布局的理想/最小尺寸——总览页 KPI+图表需要宽幅。 */
export const HUB_IDEAL_SIZE = { width: 1280, height: 832 } as const;
export const HUB_MIN_SIZE = { width: 960, height: 640 } as const;

/** Hub 初始尺寸：理想尺寸 clamp 进工作区（四周留 margin），但不低于最小可用尺寸。 */
export function hubWindowSize(
  workArea: { width: number; height: number },
  margin = 24,
): { width: number; height: number } {
  return {
    width: Math.max(
      HUB_MIN_SIZE.width,
      Math.min(HUB_IDEAL_SIZE.width, workArea.width - margin * 2),
    ),
    height: Math.max(
      HUB_MIN_SIZE.height,
      Math.min(HUB_IDEAL_SIZE.height, workArea.height - margin * 2),
    ),
  };
}

export function scaledBounds(
  current: Bounds,
  scale: number,
  base: { width: number; height: number } = CHARACTER_BASE_SIZE,
): Bounds {
  const width = Math.round(base.width * scale);
  const height = Math.round(base.height * scale);
  const centerX = current.x + current.width / 2;
  const bottom = current.y + current.height;
  return { x: Math.round(centerX - width / 2), y: Math.round(bottom - height), width, height };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** 去浮点毛刺（1.1500000000000001 → 1.15），落盘的 JSON 干净。 */
const roundTo = (v: number, digits: number): number => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};
const EPS = 1e-6;

type BodyShape = Pick<CharacterManifest, 'engine' | 'sprite'>;

/** 底座（随形象）：VRM / Live2D = 320×480；sprite = 名义格 ÷ 适配内缩（100% = 原生 1×）。 */
export function baseSizeFor(manifest: BodyShape): Size {
  if (manifest.engine !== 'sprite' || !manifest.sprite) return { ...CHARACTER_BASE_SIZE };
  const cell = manifest.sprite.layout === 'codex' ? CODEX_NOMINAL_CELL : manifest.sprite.cell;
  if (!cell) return { ...CHARACTER_BASE_SIZE };
  return {
    width: Math.round(cell.width / (1 - 2 * SPRITE_BASE_INSET.side)),
    height: Math.round(cell.height / (1 - SPRITE_BASE_INSET.top)),
  };
}

/** 像素精灵（只在设备像素整数倍间切换）：sprite 且 `fit: integer`；只设 `smoothing: pixel` 的不算。 */
export function isPixelSnap(manifest: BodyShape): boolean {
  return manifest.engine === 'sprite' && manifest.sprite?.fit === 'integer';
}

export function modelSize(base: Size, s: number): Size {
  return { width: Math.round(base.width * s), height: Math.round(base.height * s) };
}

export interface StageLayout {
  window: Size;
  /** 模型框在窗口内的矩形。 */
  model: Bounds;
}

export function stageLayout(model: Size, minCanvas: Size = MIN_CANVAS): StageLayout {
  const width = Math.max(model.width, minCanvas.width);
  const height = Math.max(model.height, minCanvas.height);
  return {
    window: { width, height },
    model: {
      x: Math.round((width - model.width) / 2),
      y: height - model.height,
      width: model.width,
      height: model.height,
    },
  };
}

/** 锚点（脚底，屏幕 DIP）→ 窗口 bounds。 */
export function boundsFromAnchor(anchor: Point, layout: StageLayout): Bounds {
  return {
    x: Math.round(anchor.x - layout.model.x - layout.model.width / 2),
    y: Math.round(anchor.y - layout.model.y - layout.model.height),
    width: layout.window.width,
    height: layout.window.height,
  };
}

export function anchorFromBounds(bounds: Bounds, layout: StageLayout): Point {
  return {
    x: bounds.x + layout.model.x + layout.model.width / 2,
    y: bounds.y + layout.model.y + layout.model.height,
  };
}

/** 默认锚点：模型框右下角距工作区右下各 24。 */
export function defaultAnchor(model: Size, workArea: Bounds, margin = DEFAULT_MARGIN): Point {
  return {
    x: workArea.x + workArea.width - margin - model.width / 2,
    y: workArea.y + workArea.height - margin,
  };
}

/**
 * 夹屏：模型框完整落在工作区内（水平、竖直各自平移；舞台边允许出屏）。
 * 模型框比工作区还大（仅极小屏）时水平居中、脚底贴工作区底。
 */
export function clampAnchor(anchor: Point, model: Size, workArea: Bounds): Point {
  const left =
    model.width > workArea.width
      ? workArea.x + (workArea.width - model.width) / 2
      : clamp(anchor.x - model.width / 2, workArea.x, workArea.x + workArea.width - model.width);
  const top =
    model.height > workArea.height
      ? workArea.y + workArea.height - model.height
      : clamp(anchor.y - model.height, workArea.y, workArea.y + workArea.height - model.height);
  return { x: left + model.width / 2, y: top + model.height };
}

/** 当前显示器上的缩放上限：min(2, 工作区 ÷ 底座)，不低于 0.5。 */
export function maxFitScale(base: Size, workArea: Size): number {
  return Math.max(
    SCALE_MIN,
    Math.min(SCALE_MAX, workArea.width / base.width, workArea.height / base.height),
  );
}

/** 设备像素整数倍的清晰档 k / dpr（k ≥ 1）落在 [lo, hi] 内的全部档位。 */
function pixelStops(dpr: number, lo: number, hi: number): number[] {
  const out: number[] = [];
  const kMin = Math.max(1, Math.ceil(lo * dpr - EPS));
  const kMax = Math.floor(hi * dpr + EPS);
  for (let k = kMin; k <= kMax; k++) out.push(roundTo(k / dpr, 4));
  return out;
}

/** 不低于 0.5 的最小清晰档（dpr ≤ 2 时即 1 / dpr）。 */
function smallestPixelStop(dpr: number): number {
  return roundTo(Math.max(1, Math.ceil(SCALE_MIN * dpr - EPS)) / dpr, 4);
}

export interface SnapOptions {
  pixelArt: boolean;
  dpr: number;
  maxFit: number;
}

/**
 * 吸附：常规 = 5% 网格并夹 [0.5, maxFit]；像素 = [0.5, maxFit] 内最近的清晰档 k / dpr，
 * 区间内无档（仅极小工作区）时取最小清晰档。
 */
export function snapScale(s: number, o: SnapOptions): number {
  if (!o.pixelArt) {
    return clamp(roundTo(Math.round(s / SCALE_STEP) * SCALE_STEP, 4), SCALE_MIN, o.maxFit);
  }
  const stops = pixelStops(o.dpr, SCALE_MIN, o.maxFit);
  if (stops.length === 0) return smallestPixelStop(o.dpr);
  let best = stops[0]!;
  for (const v of stops) if (Math.abs(v - s) < Math.abs(best - s)) best = v;
  return best;
}

/** 菜单 / D4 档位表（[0.5, 2] 全量；> maxFit 的由调用方置灰）。 */
export function scalePresets(o: { pixelArt: boolean; dpr: number }): number[] {
  if (!o.pixelArt) return [...SCALE_PRESETS];
  const stops = pixelStops(o.dpr, SCALE_MIN, SCALE_MAX);
  return stops.length > 0 ? stops : [smallestPixelStop(o.dpr)];
}

// ---- 位置记忆（F-DT-02）----

export interface DisplayInfo {
  id: string;
  workArea: Bounds;
  scaleFactor: number;
}

/** 锚点 → 工作区相对比例（夹进 0–1；零尺寸取 0.5，不出 NaN——坏值会让整份 prefs 回落默认）。 */
export function toRelative(anchor: Point, workArea: Bounds): PlacementPoint {
  const rel = (v: number, origin: number, len: number): number =>
    len > 0 ? roundTo(clamp((v - origin) / len, 0, 1), 5) : 0.5;
  return {
    rx: rel(anchor.x, workArea.x, workArea.width),
    ry: rel(anchor.y, workArea.y, workArea.height),
  };
}

export function fromRelative(rel: PlacementPoint, workArea: Bounds): Point {
  return { x: workArea.x + rel.rx * workArea.width, y: workArea.y + rel.ry * workArea.height };
}

export function resolutionKey(workArea: Size): string {
  return `${workArea.width}x${workArea.height}`;
}

/**
 * 恢复选位：上次所在屏按 id → 按该屏分辨率 → 该屏已不在则主屏同样两级 → rel null = 默认位。
 */
export function pickPlacement(
  saved: CharacterPlacement,
  displays: DisplayInfo[],
  primary: DisplayInfo,
): { display: DisplayInfo; rel: PlacementPoint | null } {
  const lookup = (d: DisplayInfo): PlacementPoint | null =>
    saved.byDisplay[d.id] ?? saved.byResolution[resolutionKey(d.workArea)] ?? null;
  const last = displays.find((d) => d.id === saved.lastDisplayId);
  if (last) {
    const rel = lookup(last);
    if (rel) return { display: last, rel };
  }
  return { display: primary, rel: lookup(primary) };
}
