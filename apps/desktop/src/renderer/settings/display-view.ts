/**
 * ㉓ D4 显示页「角色大小」纯逻辑：屏幕示意几何（工作区缩略框 + 模型框等比映射）、滑块范围、
 * 像素清晰档分段按钮。数据全来自 character.layout（Main character-stage 真源）；SFC 只做薄渲染。
 */
import type { CharacterLayout } from '@openpet/protocol';

/** 屏幕示意宽度（px）。 */
export const SCREEN_PREVIEW_W = 160;
/** 模型框再小也至少这么大（否则 50% + 4K 屏时看不见）。 */
const MIN_MARK_PX = 2;

export const pctLabel = (s: number): string => `${Math.round(s * 100)}%`;

export interface ScreenPreview {
  /** 工作区缩略框尺寸（px）。 */
  width: number;
  height: number;
  /** 模型框在缩略框内的矩形（可部分出框：被拖到屏边时如实显示，SFC 裁切）。 */
  model: { left: number; top: number; width: number; height: number };
}

export function screenPreview(l: CharacterLayout, width = SCREEN_PREVIEW_W): ScreenPreview {
  const wa = l.screen.workArea;
  const k = wa.width > 0 ? width / wa.width : 0;
  const boxX = l.screen.windowBounds.x + l.model.x;
  const boxY = l.screen.windowBounds.y + l.model.y;
  return {
    width,
    height: Math.round(wa.height * k),
    model: {
      left: (boxX - wa.x) * k,
      top: (boxY - wa.y) * k,
      width: Math.max(MIN_MARK_PX, l.model.width * k),
      height: Math.max(MIN_MARK_PX, l.model.height * k),
    },
  };
}

export interface SliderView {
  min: number;
  max: number;
  step: number;
  minLabel: string;
  maxLabel: string;
}

/** 常规形象：50% ~ 当前显示器上限 maxScale，5% 步进。 */
export function sliderView(l: CharacterLayout): SliderView {
  return { min: 0.5, max: l.maxScale, step: 0.05, minLabel: pctLabel(0.5), maxLabel: pctLabel(l.maxScale) };
}

export interface PixelStopView {
  value: number;
  /** 设备像素倍数「k×」。 */
  label: string;
  pct: string;
  enabled: boolean;
  active: boolean;
}

/** 像素精灵（fit: integer）：清晰档分段按钮；> maxScale 禁用，当前档高亮。 */
export function pixelStopsView(l: CharacterLayout): PixelStopView[] {
  return l.presets.map((v) => ({
    value: v,
    label: `${Math.max(1, Math.round(v * l.dpr))}×`,
    pct: pctLabel(v),
    enabled: v <= l.maxScale + 1e-6,
    active: Math.abs(v - l.scale) < 1e-3,
  }));
}
